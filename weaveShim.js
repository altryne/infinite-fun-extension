// weaveShim.js - Browser-compatible Weave tracing via REST API
// Based on: https://docs.wandb.ai/weave/cookbooks/weave_via_service_api

const WEAVE_API_URL = 'https://trace.wandb.ai';
let _apiKey = null;
let _projectId = null;

// Active trace context for nested spans
let _activeTrace = null;

export function init(project, options) {
    _projectId = project;
    _apiKey = options.apiKey;
    console.log('[WeaveShim] Initialized', { project, apiKey: _apiKey ? '***' : 'missing' });
}

function generateId() {
    return crypto.randomUUID();
}

function toISODateTime(date = new Date()) {
    return date.toISOString();
}

async function apiCall(endpoint, payload) {
    if (!_apiKey) {
        console.log('[WeaveShim] No API key, skipping trace');
        return null;
    }
    try {
        // W&B uses Basic auth with "api" as username and API key as password
        const basicAuth = btoa(`api:${_apiKey}`);
        
        const response = await fetch(`${WEAVE_API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${basicAuth}`
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[WeaveShim] API Error ${endpoint}:`, response.status, errorText);
            return null;
        }
        return response.json();
    } catch (e) {
        console.error(`[WeaveShim] Network Error ${endpoint}:`, e);
        return null;
    }
}

/**
 * Sanitize inputs to remove sensitive data
 */
function sanitizeInputs(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeInputs);
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('apikey') || 
            lowerKey.includes('api_key') ||
            lowerKey.includes('secret') ||
            lowerKey.includes('token') ||
            lowerKey.includes('password') ||
            lowerKey.includes('key')) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object') {
            sanitized[key] = sanitizeInputs(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

/**
 * Start a parent trace that can contain nested child spans
 * Returns a context object for creating child spans
 */
export async function startTrace(name, inputs = {}) {
    const callId = generateId();
    const traceId = generateId();
    
    const payload = {
        start: {
            project_id: _projectId,
            id: callId,
            trace_id: traceId,
            op_name: name,
            started_at: toISODateTime(),
            inputs: sanitizeInputs(inputs),
            attributes: {}
        }
    };
    
    const result = await apiCall('/call/start', payload);
    
    const context = {
        callId: result?.id || callId,
        traceId: result?.trace_id || traceId,
        name,
        startTime: Date.now()
    };
    
    // Set as active trace for nested ops
    _activeTrace = context;
    
    console.log(`[WeaveShim] Started trace: ${name}`, context.callId);
    return context;
}

/**
 * End a parent trace
 */
export async function endTrace(context, output = {}, summary = {}) {
    const payload = {
        end: {
            project_id: _projectId,
            id: context.callId,
            ended_at: toISODateTime(),
            output: output,
            summary: summary
        }
    };
    
    await apiCall('/call/end', payload);
    
    // Clear active trace
    if (_activeTrace?.callId === context.callId) {
        _activeTrace = null;
    }
    
    console.log(`[WeaveShim] Ended trace: ${context.name}`);
}

/**
 * Create a child span within the current trace
 * For LLM calls, pass messages in inputs for chat UI display
 */
export async function startChildSpan(name, inputs = {}, parentContext = null) {
    const parent = parentContext || _activeTrace;
    if (!parent) {
        console.warn('[WeaveShim] No active trace for child span, starting standalone');
        return startTrace(name, inputs);
    }
    
    const callId = generateId();
    
    const payload = {
        start: {
            project_id: _projectId,
            id: callId,
            trace_id: parent.traceId,
            parent_id: parent.callId,
            op_name: name,
            started_at: toISODateTime(),
            inputs: sanitizeInputs(inputs),
            attributes: {}
        }
    };
    
    const result = await apiCall('/call/start', payload);
    
    const context = {
        callId: result?.id || callId,
        traceId: parent.traceId,
        parentId: parent.callId,
        name,
        startTime: Date.now()
    };
    
    console.log(`[WeaveShim] Started child span: ${name}`, context.callId);
    return context;
}

/**
 * End a child span
 * For LLM calls, pass choices in output for chat UI display
 * Usage should be in format: { "model-name": { prompt_tokens, completion_tokens, total_tokens, requests } }
 */
export async function endChildSpan(context, output = {}, usage = null) {
    const summary = {};
    if (usage) {
        summary.usage = usage;
    }
    
    const payload = {
        end: {
            project_id: _projectId,
            id: context.callId,
            ended_at: toISODateTime(),
            output: output,
            summary: summary
        }
    };
    
    await apiCall('/call/end', payload);
    console.log(`[WeaveShim] Ended child span: ${context.name}`);
}

/**
 * Convenience wrapper for tracing an LLM call with proper chat UI format
 * @param {string} model - Model name (e.g., "gpt-4o")
 * @param {Array} messages - Array of {role, content} messages
 * @param {Function} llmCall - Async function that makes the LLM call
 * @param {Object} parentContext - Optional parent trace context
 */
export async function traceLLMCall(model, messages, llmCall, parentContext = null) {
    // Start child span with messages format for chat UI
    const context = await startChildSpan('llm_completion', {
        messages: messages,
        model: model
    }, parentContext);
    
    try {
        const result = await llmCall();
        
        // Format output with choices for chat UI display
        const output = {
            choices: [{
                message: {
                    content: result.prompt || result.content || result
                }
            }]
        };
        
        // Format usage with model name as key
        let usage = null;
        if (result.usage) {
            usage = {
                [model]: {
                    prompt_tokens: result.usage.prompt_tokens || 0,
                    completion_tokens: result.usage.completion_tokens || 0,
                    total_tokens: result.usage.total_tokens || 0,
                    requests: 1
                }
            };
        }
        
        await endChildSpan(context, output, usage);
        return result;
    } catch (error) {
        // End with error
        await apiCall('/call/end', {
            end: {
                project_id: _projectId,
                id: context.callId,
                ended_at: toISODateTime(),
                exception: error.toString(),
                summary: {}
            }
        });
        throw error;
    }
}

/**
 * Fetch image from URL and convert to base64 using ArrayBuffer for reliable encoding
 */
async function fetchImageAsBase64(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            console.warn('[WeaveShim] Failed to fetch image:', response.status);
            return null;
        }
        
        // Use ArrayBuffer for reliable binary handling
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Chunk-based base64 encoding to avoid stack overflow on large images
        let binary = '';
        const chunkSize = 32768;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
        }
        
        return btoa(binary);
    } catch (e) {
        console.warn('[WeaveShim] Error fetching image for Weave:', e);
        return null;
    }
}

/**
 * Detect image type from URL or default to png
 */
function detectImageType(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg') || lowerUrl.includes('jpeg')) {
        return 'jpeg';
    }
    if (lowerUrl.includes('.webp')) {
        return 'webp';
    }
    if (lowerUrl.includes('.gif')) {
        return 'gif';
    }
    return 'png';
}

/**
 * Create a Weave Image object from image data
 * This matches the format expected by Weave: { _weaveType: 'Image', data: base64, imageType: 'png' }
 */
export function weaveImage({ data, imageType = 'png' }) {
    return {
        _weaveType: 'Image',
        data: data,  // base64 encoded
        imageType: imageType
    };
}

/**
 * Convenience wrapper for tracing an image generation call
 * Uses base64 directly from API when available, otherwise fetches
 * @param {string} model - Model name (e.g., "fal-z-image-turbo")
 * @param {string} prompt - Image generation prompt
 * @param {Function} imageCall - Async function that returns {url, base64?, imageType}
 * @param {Object} parentContext - Optional parent trace context
 */
export async function traceImageCall(model, prompt, imageCall, parentContext = null) {
    const context = await startChildSpan('image_generation', {
        prompt: prompt,
        model: model
    }, parentContext);
    
    try {
        const imageResult = await imageCall();
        
        // imageResult can be: { url, base64?, imageType } or just a string URL (legacy)
        const isLegacyUrl = typeof imageResult === 'string';
        const imageUrl = isLegacyUrl ? imageResult : imageResult.url;
        let base64Data = isLegacyUrl ? null : imageResult.base64;
        let imageType = isLegacyUrl ? detectImageType(imageUrl) : imageResult.imageType;
        
        // Build output
        let output = {
            image_url: imageUrl,
            model: model,
            prompt: prompt
        };
        
        // Use base64 from API if available, otherwise fetch it
        if (!base64Data) {
            console.log('[WeaveShim] No base64 from API, fetching image...');
            base64Data = await fetchImageAsBase64(imageUrl);
        }
        
        if (base64Data) {
            output.image = weaveImage({ data: base64Data, imageType: imageType || 'jpeg' });
            console.log(`[WeaveShim] Image ready (${imageType}, ${Math.round(base64Data.length / 1024)}KB)`);
        }
        
        await endChildSpan(context, output, null);
        return imageResult;  // Return full result so caller has access to base64
    } catch (error) {
        await apiCall('/call/end', {
            end: {
                project_id: _projectId,
                id: context.callId,
                ended_at: toISODateTime(),
                exception: error.toString(),
                summary: {}
            }
        });
        throw error;
    }
}

// Legacy op() function for backwards compatibility - but prefer explicit trace functions
export function op(arg1, arg2) {
    let func, name;
    
    if (typeof arg1 === 'function') {
        func = arg1;
        name = arg2?.name || func.name || 'anonymous';
    } else if (typeof arg1 === 'string') {
        name = arg1;
        func = arg2;
    } else {
        throw new Error('Invalid op() arguments');
    }

    return async function tracedOp(...args) {
        const context = await startChildSpan(name, { args: sanitizeInputs(args) });
        
        try {
            const result = await func.apply(this, args);
            await endChildSpan(context, result, null);
            return result;
        } catch (error) {
            await apiCall('/call/end', {
                end: {
                    project_id: _projectId,
                    id: context.callId,
                    ended_at: toISODateTime(),
                    exception: error.toString(),
                    summary: {}
                }
            });
            throw error;
        }
    };
}
