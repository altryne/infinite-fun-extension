// apiHandler.js
// This file is responsible for interactions with the FAL and Replicate APIs for image generation

/**
 * Function to generate an image based on the prompt using FAL API
 * Returns both URL and base64 data when available
 * @param {string} prompt - The prompt for the image generation
 * @param {string} apiKey - The FAL API Key
 * @param {string} model - The FAL model path (e.g. 'fal-ai/z-image/turbo')
 * @returns {Promise<{url: string, base64?: string, imageType: string}>}
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
        // Request with sync_mode to get immediate result
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
                sync_mode: true,  // Get immediate result
                output_format: "jpeg"  // jpeg is smaller than png
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`FAL API Error: ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        console.log('FAL Response:', Object.keys(data));

        if (data.images && data.images.length > 0) {
            const image = data.images[0];
            
            // FAL returns url, and may also include base64 in content_type scenarios
            const result = {
                url: image.url,
                imageType: 'jpeg'
            };
            
            // If FAL returned base64 data directly (some endpoints do)
            if (image.base64) {
                result.base64 = image.base64;
            }
            
            return result;
        }

        // Fallback to polling if sync_mode didn't work
        const requestId = data.request_id;
        if (!requestId) {
            throw new Error(`FAL Response missing images and request_id: ${JSON.stringify(data)}`);
        }

        // Poll for Result
        let attempts = 0;
        while (attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            
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
                    return {
                        url: statusData.images[0].url,
                        base64: statusData.images[0].base64 || null,
                        imageType: 'jpeg'
                    };
                }
                throw new Error('No image in completed response');
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
 * Returns both URL and base64 data when available
 * @param {string} prompt - The prompt for the image generation
 * @param {string} apiKey - The Replicate API Key
 * @param {string} model - The model to use ('replicate-z-image-turbo' or 'replicate-pruna-p-image')
 * @returns {Promise<{url: string, base64?: string, imageType: string}>}
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
        version = "7ea16386290ff5977c7812e66e462d7ec3954d8e007a8cd18ded3e7d41f5d7cf";
        input = {
            height: 768,
            prompt: prompt,
            output_format: "jpg"  // Request jpg for smaller size
        };
    } else if (model === 'replicate-pruna-p-image') {
        apiUrl = 'https://api.replicate.com/v1/models/prunaai/p-image/predictions';
        version = null;
        input = {
            prompt: prompt
        };
    } else {
        throw new Error(`Unknown Replicate model: ${model}`);
    }

    const body = { input };
    if (version) {
        body.version = version;
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'wait'
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Replicate API Error: ${JSON.stringify(errorData)}`);
        }

        let data = await response.json();
        console.log('Replicate Response status:', data.status);

        // Helper to extract result
        const extractResult = (output) => {
            const url = Array.isArray(output) ? output[0] : output;
            
            // Check if it's a data URI (base64)
            if (typeof url === 'string' && url.startsWith('data:image')) {
                const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
                if (match) {
                    return {
                        url: url,
                        base64: match[2],
                        imageType: match[1]
                    };
                }
            }
            
            // Detect image type from URL
            let imageType = 'jpeg';
            if (url.includes('.png')) imageType = 'png';
            if (url.includes('.webp')) imageType = 'webp';
            
            return {
                url: url,
                imageType: imageType
            };
        };

        // Check if completed immediately
        if (data.status === 'succeeded' && data.output) {
            return extractResult(data.output);
        }

        // Poll for Result
        const getUrl = data.urls?.get;
        if (!getUrl) {
            throw new Error(`Replicate Response missing get url: ${JSON.stringify(data)}`);
        }

        let attempts = 0;
        while (attempts < 40) {
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
                return extractResult(data.output);
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
