// llmHandler.js

/**
 * Generates a creative image prompt based on the provided texts using OpenAI's API.
 * @param {Array} texts - Array of text objects extracted from the page.
 * @param {string} apiKey - OpenAI API Key.
 * @param {string} model - OpenAI model to use.
 * @param {string} previousPrompt - The previously generated prompt to maintain story continuity.
 * @returns {Promise<string>} - The generated image prompt.
 */
async function generatePromptFromTexts(texts, apiKey, model = 'gpt-oss-120b', previousPrompt = '') {
    if (!apiKey) {
        throw new Error('API Key is missing.');
    }

    const itemsList = texts.map(t => t.text).join(', ');
    
    const systemPrompt = `You are a Master Visual Storyteller. Your task is to create a vivid, hyper-realistic, cinematic, 8k resolution image prompt based on a list of items provided by the user.
    
    The items are from the game "Infinite Craft". 
    
    CRITICAL INSTRUCTION: You must treat this as a continuous visual story. 
    If a "Previous Scene Description" is provided, you MUST evolve that scene to incorporate the new items. 
    Do not start from scratch unless the new items are completely incompatible.
    
    Output: A concise, 2-3 sentence image prompt. Focus on the most important visual elements. Do not use JSON.

    Examples:
    1. "A massive stone golem rises from a lake of molten lava, its body cracking with glowing veins of magma. Ash falls like snow around it, settling on the dark basalt cliffs that surround the fiery pit."
    2. "A futuristic city built into the branches of a giant world-tree, with glass walkways connecting the leaves. Hovercars zip between the branches, their lights leaving trails against the twilight sky."
    3. "An astronaut stands on the surface of a purple moon, looking up at a ringed gas giant that dominates the horizon. Crystalline structures jut out of the ground, reflecting the pale light of a distant star."`;

    let userPrompt = `Current Items: ${itemsList}`;
    if (previousPrompt) {
        userPrompt += `\n\nPrevious Scene Description: ${previousPrompt}\n\nInstruction: Evolve the previous scene with the new items. Keep it concise (2-3 sentences).`;
    } else {
        userPrompt += `\n\nInstruction: Create a new fantasy scene based on these items. Keep it concise (2-3 sentences).`;
    }

    try {
        const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 65536,
                temperature: 1,
                top_p: 1,
                reasoning_effort: "medium",
                stream: false
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const promptText = data.choices[0].message.content.trim();
        
        // Return both the prompt and usage data for tracing
        return {
            prompt: promptText,
            model: model,
            usage: data.usage || null  // { prompt_tokens, completion_tokens, total_tokens }
        };

    } catch (error) {
        console.error('Error generating prompt from LLM:', error);
        throw error;
    }
}

export { generatePromptFromTexts };
