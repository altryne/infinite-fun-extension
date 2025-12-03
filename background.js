// background.js
import * as weave from './weaveShim.js';
import { generatePromptFromTexts } from './llmHandler.js';
import { getImageFromFal, getImageFromReplicate } from './apiHandler.js';

// State
let weaveInitialized = false;
let isGenerating = false;
let lastGeneratedPrompt = '';
let lastUpdateTime = 0;

// Initialize Weave tracing
async function initWeave() {
    if (weaveInitialized) return;

    const settings = await chrome.storage.sync.get({ 
        wandbApiKey: '', 
        wandbTeam: '',
        weaveProject: 'infinite-fun'
    });
    
    if (settings.wandbApiKey && settings.wandbTeam) {
        console.log('Initializing Weave...');
        try {
            // Project ID format: team/project
            const projectId = `${settings.wandbTeam}/${settings.weaveProject}`;
            weave.init(projectId, {
                apiKey: settings.wandbApiKey,
            });
            weaveInitialized = true;
            console.log('Weave initialized successfully:', projectId);
        } catch (e) {
            console.error('Failed to initialize Weave:', e);
        }
    } else {
        if (!settings.wandbApiKey) {
            console.log('Weave API Key not found. Tracing disabled.');
        }
        if (!settings.wandbTeam) {
            console.log('W&B Team not configured. Tracing disabled.');
        }
    }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateTexts') {
        handleUpdateTexts(message.texts, sender.tab.id);
    } else if (message.action === 'regenerateImage') {
        handleRegenerateImage();
    }
});

async function handleUpdateTexts(texts, tabId) {
    await initWeave();

    const now = Date.now();

    // Debounce: Ignore updates if less than 2 seconds have passed since last update
    if (now - lastUpdateTime < 2000) {
        console.log('Skipping update: too soon');
        return;
    }

    // Lock: Ignore if currently generating
    if (isGenerating) {
        console.log('Skipping update: already generating');
        return;
    }

    try {
        const startTotal = Date.now();
        isGenerating = true;
        lastUpdateTime = now;

        // Set badge to indicating processing
        chrome.action.setBadgeText({ text: '...' });
        chrome.action.setBadgeBackgroundColor({ color: '#4285F4' });

        // Get API keys and settings
        const settings = await chrome.storage.sync.get({
            openaiApiKey: '',
            falApiKey: '',
            replicateApiKey: '',
            imageModel: 'fal-z-image-turbo',
            llmModel: 'gpt-4o-mini'
        });

        if (!settings.openaiApiKey) {
            console.warn('Missing OpenAI API Key.');
            chrome.action.setBadgeText({ text: 'KEY' });
            chrome.action.setBadgeBackgroundColor({ color: '#F4B400' });
            isGenerating = false;
            return;
        }

        // Check if appropriate image API key is present
        if (settings.imageModel.startsWith('fal') && !settings.falApiKey) {
            console.warn('Missing FAL API Key.');
            chrome.action.setBadgeText({ text: 'KEY' });
            chrome.action.setBadgeBackgroundColor({ color: '#F4B400' });
            isGenerating = false;
            return;
        }

        if (settings.imageModel.startsWith('replicate') && !settings.replicateApiKey) {
            console.warn('Missing Replicate API Key.');
            chrome.action.setBadgeText({ text: 'KEY' });
            chrome.action.setBadgeBackgroundColor({ color: '#F4B400' });
            isGenerating = false;
            return;
        }

        console.log('Generating prompt for texts:', texts);
        
        // Extract element names for display
        const elementNames = texts.map(t => t.text).join(', ');

        // Start parent trace for the entire pipeline
        const traceInputs = { elements: elementNames };
        if (lastGeneratedPrompt) {
            traceInputs.previous_prompt = lastGeneratedPrompt;
        }
        const traceContext = await weave.startTrace('generate_creative_image', traceInputs);

        try {
            // === LLM Call ===
            const startLLM = Date.now();
            const llmResult = await generatePromptFromTexts(texts, settings.openaiApiKey, settings.llmModel, lastGeneratedPrompt);
            const durationLLM = Date.now() - startLLM;
            
            const prompt = llmResult.prompt;
            console.log(`LLM Generation took ${durationLLM}ms`);
            console.log('Generated Prompt:', prompt);

            // Update history
            lastGeneratedPrompt = prompt;
            chrome.storage.local.set({ lastGeneratedPrompt: prompt });

            // === Image Generation ===
            const startImageGen = Date.now();
            let imageResult;
            if (settings.imageModel.startsWith('replicate')) {
                imageResult = await getImageFromReplicate(prompt, settings.replicateApiKey, settings.imageModel);
            } else {
                imageResult = await getImageFromFal(prompt, settings.falApiKey, settings.imageModel);
            }
            const durationImageGen = Date.now() - startImageGen;

            // Handle both new format {url, base64, imageType} and legacy string URL
            const imageUrl = typeof imageResult === 'string' ? imageResult : imageResult.url;
            const imageBase64 = typeof imageResult === 'object' ? imageResult.base64 : null;
            const imageType = typeof imageResult === 'object' ? imageResult.imageType : 'jpeg';

            const totalDuration = Date.now() - startTotal;
            console.log(`Image Generation took ${durationImageGen}ms`);
            console.log(`Total Pipeline took ${totalDuration}ms`);
            console.log('Generated Image URL:', imageUrl);

            // === SEND TO USER IMMEDIATELY ===
            if (tabId) {
                console.log('Sending updateBackground message to tab:', tabId);
                chrome.tabs.sendMessage(tabId, {
                    action: 'updateBackground',
                    imageUrl: imageUrl,
                    prompt: prompt,
                    stats: {
                        llm: durationLLM,
                        imageGen: durationImageGen,
                        total: totalDuration
                    }
                });
            }

            // Clear badge on success
            chrome.action.setBadgeText({ text: '' });

            // === TRACE IN BACKGROUND (fire and forget) ===
            (async () => {
                try {
                    // If no base64 from API (e.g. Replicate), fetch and convert
                    let traceBase64 = imageBase64;
                    let traceImageType = imageType;
                    
                    if (!traceBase64 && imageUrl) {
                        console.log('[Weave] Fetching image for trace...', imageUrl.substring(0, 50));
                        try {
                            const imgResponse = await fetch(imageUrl);
                            if (imgResponse.ok) {
                                // Get content type from response headers, fallback to URL detection
                                const contentType = imgResponse.headers.get('content-type') || '';
                                console.log('[Weave] Image content-type:', contentType);
                                
                                if (contentType.includes('png') || imageUrl.includes('.png')) traceImageType = 'png';
                                else if (contentType.includes('webp') || imageUrl.includes('.webp')) traceImageType = 'webp';
                                else if (contentType.includes('gif') || imageUrl.includes('.gif')) traceImageType = 'gif';
                                else traceImageType = 'jpeg';
                                
                                // Use ArrayBuffer for more reliable binary handling
                                const arrayBuffer = await imgResponse.arrayBuffer();
                                const bytes = new Uint8Array(arrayBuffer);
                                
                                // Chunk-based base64 encoding to avoid stack overflow
                                let binary = '';
                                const chunkSize = 32768;
                                for (let i = 0; i < bytes.length; i += chunkSize) {
                                    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                                    binary += String.fromCharCode.apply(null, chunk);
                                }
                                traceBase64 = btoa(binary);
                                
                                console.log(`[Weave] Image encoded (${traceImageType}, ${Math.round(traceBase64.length / 1024)}KB, ${bytes.length} bytes)`);
                            } else {
                                console.warn('[Weave] Fetch failed:', imgResponse.status);
                            }
                        } catch (fetchErr) {
                            console.warn('[Weave] Could not fetch image:', fetchErr);
                        }
                    }

                    // Build messages for Weave chat UI
                    const systemPrompt = `You are a Master Visual Storyteller creating vivid, cinematic image prompts from Infinite Craft elements.`;
                    const userContent = `Elements: ${elementNames}`;
                    const messages = [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ];

                    // LLM child span
                    const llmContext = await weave.startChildSpan('llm_completion', {
                        messages: messages,
                        model: settings.llmModel
                    }, traceContext);
                    
                    await weave.endChildSpan(llmContext, {
                        choices: [{ message: { content: prompt } }]
                    }, llmResult.usage ? {
                        [settings.llmModel]: {
                            prompt_tokens: llmResult.usage.prompt_tokens || 0,
                            completion_tokens: llmResult.usage.completion_tokens || 0,
                            total_tokens: llmResult.usage.total_tokens || 0,
                            requests: 1
                        }
                    } : null);

                    // Build data URI for image display
                    const dataUri = traceBase64 
                        ? `data:image/${traceImageType};base64,${traceBase64}` 
                        : null;

                    // Image child span - includes image + URL
                    const imgContext = await weave.startChildSpan('image_generation', {
                        prompt: prompt,
                        model: settings.imageModel
                    }, traceContext);
                    
                    let imgOutput = { 
                        model: settings.imageModel,
                        image_url: imageUrl
                    };
                    if (dataUri) {
                        imgOutput.image = { _weaveType: 'Image', data: dataUri, imageType: traceImageType };
                    }
                    await weave.endChildSpan(imgContext, imgOutput, null);

                    // End parent trace - image as main display
                    const parentOutput = {
                        prompt: prompt,
                        image_model: settings.imageModel
                    };
                    if (dataUri) {
                        parentOutput.image = { _weaveType: 'Image', data: dataUri, imageType: traceImageType };
                    }
                    
                    await weave.endTrace(traceContext, parentOutput, {
                        usage: llmResult.usage ? {
                            [settings.llmModel]: {
                                prompt_tokens: llmResult.usage.prompt_tokens || 0,
                                completion_tokens: llmResult.usage.completion_tokens || 0,
                                total_tokens: llmResult.usage.total_tokens || 0,
                                requests: 1
                            }
                        } : {}
                    });
                    
                    console.log('[Weave] Tracing completed in background');
                } catch (traceError) {
                    console.error('[Weave] Background tracing error:', traceError);
                }
            })();

        } catch (innerError) {
            // End parent trace with error (fire and forget)
            weave.endTrace(traceContext, { error: innerError.toString() }, {}).catch(() => {});
            throw innerError;
        }

    } catch (error) {
        console.error('Error in handleUpdateTexts:', error);
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#DB4437' });
    } finally {
        isGenerating = false;
    }
}

async function handleRegenerateImage() {
    await initWeave();

    // Try to get from memory first, then storage
    if (!lastGeneratedPrompt) {
        const stored = await chrome.storage.local.get('lastGeneratedPrompt');
        if (stored.lastGeneratedPrompt) {
            lastGeneratedPrompt = stored.lastGeneratedPrompt;
        }
    }

    if (!lastGeneratedPrompt) {
        console.log('No prompt to regenerate');
        return;
    }

    if (isGenerating) {
        console.log('Skipping regeneration: already generating');
        return;
    }

    try {
        isGenerating = true;
        const startTotal = Date.now();

        // Set badge to indicating processing
        chrome.action.setBadgeText({ text: '...' });
        chrome.action.setBadgeBackgroundColor({ color: '#4285F4' });

        console.log('Regenerating image for prompt:', lastGeneratedPrompt);

        // Find active tab to send message to
        const tabs = await chrome.tabs.query({ url: "https://neal.fun/infinite-craft/*" });
        let tabId = null;
        if (tabs.length > 0) {
            tabId = tabs[0].id;
            console.log('Found Infinite Craft tab:', tabId);
        } else {
            console.warn('No Infinite Craft tab found to send update to.');
        }

        // Get settings
        const settings = await chrome.storage.sync.get({
            falApiKey: '',
            replicateApiKey: '',
            imageModel: 'fal-z-image-turbo'
        });

        // Start trace for regeneration
        const traceContext = await weave.startTrace('regenerate_image', {
            prompt: lastGeneratedPrompt
        });

        try {
            // Image generation
            const startImageGen = Date.now();
            let imageResult;
            if (settings.imageModel.startsWith('replicate')) {
                imageResult = await getImageFromReplicate(lastGeneratedPrompt, settings.replicateApiKey, settings.imageModel);
            } else {
                imageResult = await getImageFromFal(lastGeneratedPrompt, settings.falApiKey, settings.imageModel);
            }
            const durationImageGen = Date.now() - startImageGen;

            const imageUrl = typeof imageResult === 'string' ? imageResult : imageResult.url;
            const imageBase64 = typeof imageResult === 'object' ? imageResult.base64 : null;
            const imageType = typeof imageResult === 'object' ? imageResult.imageType : 'jpeg';

            const totalDuration = Date.now() - startTotal;
            console.log(`Image Generation took ${durationImageGen}ms`);

            // === SEND TO USER IMMEDIATELY ===
            if (tabId) {
                chrome.tabs.sendMessage(tabId, {
                    action: 'updateBackground',
                    imageUrl: imageUrl,
                    prompt: lastGeneratedPrompt,
                    stats: { 
                        imageGen: durationImageGen,
                        total: totalDuration 
                    }
                });
            }

            // Clear badge on success
            chrome.action.setBadgeText({ text: '' });

            // === TRACE IN BACKGROUND ===
            (async () => {
                try {
                    // If no base64 from API, fetch and convert
                    let traceBase64 = imageBase64;
                    let traceImageType = imageType;
                    
                    if (!traceBase64 && imageUrl) {
                        console.log('[Weave] Fetching image for trace...', imageUrl.substring(0, 50));
                        try {
                            const imgResponse = await fetch(imageUrl);
                            if (imgResponse.ok) {
                                // Get content type from response headers, fallback to URL detection
                                const contentType = imgResponse.headers.get('content-type') || '';
                                console.log('[Weave] Image content-type:', contentType);
                                
                                if (contentType.includes('png') || imageUrl.includes('.png')) traceImageType = 'png';
                                else if (contentType.includes('webp') || imageUrl.includes('.webp')) traceImageType = 'webp';
                                else if (contentType.includes('gif') || imageUrl.includes('.gif')) traceImageType = 'gif';
                                else traceImageType = 'jpeg';
                                
                                // Use ArrayBuffer for more reliable binary handling
                                const arrayBuffer = await imgResponse.arrayBuffer();
                                const bytes = new Uint8Array(arrayBuffer);
                                
                                // Chunk-based base64 encoding to avoid stack overflow
                                let binary = '';
                                const chunkSize = 32768;
                                for (let i = 0; i < bytes.length; i += chunkSize) {
                                    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                                    binary += String.fromCharCode.apply(null, chunk);
                                }
                                traceBase64 = btoa(binary);
                                
                                console.log(`[Weave] Image encoded (${traceImageType}, ${Math.round(traceBase64.length / 1024)}KB, ${bytes.length} bytes)`);
                            } else {
                                console.warn('[Weave] Fetch failed:', imgResponse.status);
                            }
                        } catch (fetchErr) {
                            console.warn('[Weave] Could not fetch image:', fetchErr);
                        }
                    }

                    // Build data URI for image display
                    const dataUri = traceBase64 
                        ? `data:image/${traceImageType};base64,${traceBase64}` 
                        : null;

                    // Image child span - includes image + URL
                    const imgContext = await weave.startChildSpan('image_generation', {
                        prompt: lastGeneratedPrompt,
                        model: settings.imageModel
                    }, traceContext);
                    
                    let imgOutput = { 
                        model: settings.imageModel,
                        image_url: imageUrl
                    };
                    if (dataUri) {
                        imgOutput.image = { _weaveType: 'Image', data: dataUri, imageType: traceImageType };
                    }
                    await weave.endChildSpan(imgContext, imgOutput, null);

                    // End parent trace - image as main display
                    const traceOutput = {
                        image_model: settings.imageModel
                    };
                    if (dataUri) {
                        traceOutput.image = { _weaveType: 'Image', data: dataUri, imageType: traceImageType };
                    }
                    await weave.endTrace(traceContext, traceOutput, {});
                    
                    console.log('[Weave] Regenerate tracing completed');
                } catch (traceError) {
                    console.error('[Weave] Regenerate tracing error:', traceError);
                }
            })();

        } catch (innerError) {
            weave.endTrace(traceContext, { error: innerError.toString() }, {}).catch(() => {});
            throw innerError;
        }

    } catch (error) {
        console.error('Error in handleRegenerateImage:', error);
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#DB4437' });
    } finally {
        isGenerating = false;
    }
}
