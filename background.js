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

// Wrap functions for tracing
const tracedGeneratePrompt = weave.op(async (texts, apiKey, model, previousPrompt) => {
    const result = await generatePromptFromTexts(texts, apiKey, model, previousPrompt);
    
    // Attach usage data for Weave tracing (will be extracted and logged in summary)
    if (result.usage) {
        result._weaveUsage = weave.createLLMUsage(
            result.model,
            result.usage.prompt_tokens || 0,
            result.usage.completion_tokens || 0
        );
    }
    
    return result;
}, { name: 'generate_prompt' });

const tracedGenerateImage = weave.op(async (prompt, settings) => {
    let imageUrl;
    if (settings.imageModel && settings.imageModel.startsWith('replicate')) {
        imageUrl = await getImageFromReplicate(prompt, settings.replicateApiKey, settings.imageModel);
    } else {
        imageUrl = await getImageFromFal(prompt, settings.falApiKey, settings.imageModel);
    }
    
    // Return with weave image metadata for tracing
    if (imageUrl) {
        return {
            imageUrl: imageUrl,
            weaveImage: await weave.weaveImage({ url: imageUrl })
        };
    }
    return { imageUrl };
}, { name: 'generate_image' });

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
        console.log('Previous Prompt:', lastGeneratedPrompt);

        const startLLM = Date.now();
        
        // Generate Prompt using LLM (Traced)
        const llmResult = await tracedGeneratePrompt(texts, settings.openaiApiKey, settings.llmModel, lastGeneratedPrompt);
        const prompt = llmResult.prompt;
        const durationLLM = Date.now() - startLLM;
        console.log(`LLM Generation took ${durationLLM}ms`);
        console.log('Generated Prompt:', prompt);
        if (llmResult.usage) {
            console.log('Token usage:', llmResult.usage);
        }

        // Update history
        lastGeneratedPrompt = prompt;
        // Persist to storage
        chrome.storage.local.set({ lastGeneratedPrompt: prompt });

        await generateAndSendImage(prompt, tabId, startTotal, durationLLM, settings);

        // Clear badge on success
        chrome.action.setBadgeText({ text: '' });

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

        // Get settings again as we need them for generation
        const settings = await chrome.storage.sync.get({
            falApiKey: '',
            replicateApiKey: '',
            imageModel: 'fal-z-image-turbo'
        });

        // We don't have LLM duration here, so pass 0
        await generateAndSendImage(lastGeneratedPrompt, tabId, startTotal, 0, settings);

        // Clear badge on success
        chrome.action.setBadgeText({ text: '' });

    } catch (error) {
        console.error('Error in handleRegenerateImage:', error);
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#DB4437' });
    } finally {
        isGenerating = false;
    }
}

async function generateAndSendImage(prompt, tabId, startTotal, durationLLM, settings) {
    // Check if appropriate image API key is present
    if (settings.imageModel && settings.imageModel.startsWith('fal') && !settings.falApiKey) {
        return;
    }
    if (settings.imageModel && settings.imageModel.startsWith('replicate') && !settings.replicateApiKey) {
        return;
    }

    const startImageGen = Date.now();

    // Generate Image (Traced)
    const result = await tracedGenerateImage(prompt, settings);
    const imageUrl = result.imageUrl;

    const durationImageGen = Date.now() - startImageGen;
    console.log(`Image Generation (${settings.imageModel}) took ${durationImageGen}ms`);
    console.log('Generated Image URL:', imageUrl);

    const totalDuration = Date.now() - startTotal;
    console.log(`Total Pipeline took ${totalDuration}ms`);

    // Send Image back to Content Script
    if (tabId) {
        console.log('Sending updateBackground message to tab:', tabId, 'URL:', imageUrl);
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
    } else {
        console.warn('No tabId provided to generateAndSendImage');
    }
}
