// apiHandler.js
// This file is responsible for interactions with the FAL API for image generation

/**
 * Function to generate an image based on the prompt using FAL API
 * @param {string} prompt - The prompt for the image generation
 * @param {string} apiKey - The FAL API Key
 * @param {string} model - The FAL model path (e.g. 'fal-ai/z-image/turbo')
 * @returns {Promise<string>} - A promise that resolves with the image URL or base64 data
 */
async function getImageFromFal(prompt, apiKey, model) {
    // Default to z-image-turbo if no model provided or if it's the default string
    let modelPath = 'fal-ai/z-image/turbo';
    
    if (model && model.startsWith('fal-')) {
        if (model === 'fal-z-image-turbo') {
            modelPath = 'fal-ai/z-image/turbo';
        } else if (model.startsWith('fal-')) {
             modelPath = model.substring(4);
        } else {
             modelPath = model;
        }
    }

    const apiUrl = `https://fal.run/${modelPath}`;
    console.log('FAL API URL:', apiUrl);
    console.log('FAL Model Path:', modelPath);
    
    if (!apiKey) {
        throw new Error('FAL API Key is missing.');
    }

    try {
        // 1. Submit Request
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${apiKey}`
            },
            body: JSON.stringify({
                prompt: prompt,
                seed: Math.floor(Math.random() * 10000000),
                image_size: "landscape_4_3",
                sync_mode: false // Request async to get URL
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`FAL API Error: ${JSON.stringify(errorData)}`);
        }

        const initialData = await response.json();
        console.log('FAL Initial Response:', initialData);

        // Check if we got an immediate result (even with sync_mode: false, some endpoints might do this)
        if (initialData.images && initialData.images.length > 0) {
            console.log('FAL returned immediate result');
            return initialData.images[0].url;
        }

        const requestId = initialData.request_id;
        if (!requestId) {
            throw new Error(`FAL Response missing request_id: ${JSON.stringify(initialData)}`);
        }

        // 2. Poll for Result
        let attempts = 0;
        while (attempts < 20) { // Timeout after ~10 seconds
            await new Promise(r => setTimeout(r, 500)); // Poll every 500ms
            
            const statusResponse = await fetch(`${apiUrl}/requests/${requestId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Key ${apiKey}`
                }
            });

            if (!statusResponse.ok) {
                throw new Error(`FAL Status Error: ${statusResponse.statusText}`);
            }

            const statusData = await statusResponse.json();
            
            if (statusData.status === 'COMPLETED') {
                if (statusData.images && statusData.images.length > 0) {
                    return statusData.images[0].url;
                }
                throw new Error('No image URL in completed response');
            } else if (statusData.status === 'FAILED') {
                throw new Error(`FAL Request Failed: ${statusData.error}`);
            }
            
            attempts++;
        }
        
        throw new Error('FAL Request Timed Out');

    } catch (error) {
        console.error('Error fetching image from FAL API:', error);
        throw error;
    }
}

/**
 * Function to generate an image based on the prompt using Replicate API
 * @param {string} prompt - The prompt for the image generation
 * @param {string} apiKey - The Replicate API Key
 * @param {string} model - The model to use ('replicate-z-image-turbo' or 'replicate-pruna-p-image')
 * @returns {Promise<string>} - A promise that resolves with the image URL
 */
async function getImageFromReplicate(prompt, apiKey, model) {
    if (!apiKey) {
        throw new Error('Replicate API Key is missing.');
    }

    let apiUrl;
    let version;
    let input;

    if (model === 'replicate-z-image-turbo') {
        apiUrl = 'https://api.replicate.com/v1/predictions';
        // z-image-turbo version
        version = "7ea16386290ff5977c7812e66e462d7ec3954d8e007a8cd18ded3e7d41f5d7cf";
        input = {
            height: 768,
            prompt: prompt
        };
    } else if (model === 'replicate-pruna-p-image') {
        apiUrl = 'https://api.replicate.com/v1/models/prunaai/p-image/predictions';
        version = null; // Model endpoint doesn't need version in body usually, but let's check docs if needed. 
                        // The user provided curl uses model endpoint, so we use that.
        input = {
            prompt: prompt
        };
    } else {
        throw new Error(`Unknown Replicate model: ${model}`);
    }

    const body = {
        input: input
    };
    
    if (version) {
        body.version = version;
    }

    try {
        // 1. Submit Request
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'wait' // Request to wait for result if possible
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Replicate API Error: ${JSON.stringify(errorData)}`);
        }

        let data = await response.json();
        console.log('Replicate Initial Response:', data);

        // Check if completed immediately (due to Prefer: wait)
        if (data.status === 'succeeded' && data.output) {
             // Output can be a string (URL) or array of strings
             return Array.isArray(data.output) ? data.output[0] : data.output;
        }

        // 2. Poll for Result if not ready
        const getUrl = data.urls.get;
        if (!getUrl) {
             throw new Error(`Replicate Response missing get url: ${JSON.stringify(data)}`);
        }

        let attempts = 0;
        while (attempts < 40) { // Timeout after ~20 seconds
            await new Promise(r => setTimeout(r, 500)); 
            
            const statusResponse = await fetch(getUrl, {
                method: 'GET',
                headers: {
                     'Authorization': `Bearer ${apiKey}`,
                     'Content-Type': 'application/json'
                }
            });

            if (!statusResponse.ok) {
                throw new Error(`Replicate Status Error: ${statusResponse.statusText}`);
            }

            data = await statusResponse.json();
            
            if (data.status === 'succeeded') {
                return Array.isArray(data.output) ? data.output[0] : data.output;
            } else if (data.status === 'failed') {
                throw new Error(`Replicate Request Failed: ${data.error}`);
            } else if (data.status === 'canceled') {
                 throw new Error('Replicate Request Canceled');
            }
            
            attempts++;
        }
        
        throw new Error('Replicate Request Timed Out');

    } catch (error) {
        console.error('Error fetching image from Replicate API:', error);
        throw error;
    }
}

export { getImageFromFal, getImageFromReplicate };
