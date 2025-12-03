# Infinite Fun Extension 🎨✨

A Chrome extension that brings AI-powered image generation to [Neal Agarwal's Infinite Craft](https://neal.fun/infinite-craft/) game. Watch as your crafted elements come to life with dynamically generated backgrounds!

![Weave Tracing](https://img.shields.io/badge/Traced%20with-Weave-blue?logo=weightsandbiases)

![1202 (1)](https://github.com/user-attachments/assets/2e390eb2-60d0-4d6c-94eb-5e4ce471da75)


## What is this?

This extension monitors your Infinite Craft gameplay and automatically generates stunning AI images based on the elements you create. It's a fun, novel way to:

- **Compare image generation models** side-by-side (FAL, Replicate)
- **Experiment with different LLMs** for creative prompt generation
- **Track and analyze your AI pipeline** with [Weave](https://weave-docs.wandb.ai/) observability

## Features

- 🖼️ **Real-time image generation** as you play Infinite Craft
- 🎯 **Multiple model support**: FAL (z-image-turbo) and Replicate (pruna-p-image)
- 🧠 **Smart prompt evolution**: The LLM maintains story continuity across generations
- 📊 **Full observability with Weave**: Track every LLM call, token usage, and image generation

## Weave Integration



https://github.com/user-attachments/assets/4bd5ec96-b22c-47bd-9842-3d53bda2a198



This extension is fully instrumented with [Weights & Biases Weave](https://weave-docs.wandb.ai/) for observability. Every AI call is traced, letting you:

- See exact prompts sent to LLMs and responses received
- Track token usage and costs across different models
- Compare image generation quality and latency
- Debug and iterate on your prompt engineering

![Weave Dashboard](https://raw.githubusercontent.com/wandb/weave/main/docs/static/img/weave-hero.png)

## Installation

### 1. Clone or Download

```bash
git clone https://github.com/YOUR_USERNAME/infinite-fun-extension.git
cd infinite-fun-extension
```

### 2. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `infinite-fun-extension` folder

### 3. Configure API Keys

Click the extension icon → **Options** (or right-click → Options) and add:

| Key | Required | Get it from |
|-----|----------|-------------|
| **LLM API Key** | Yes | Your LLM provider (Cerebras, OpenAI, etc.) |
| **FAL API Key** | Yes* | [fal.ai](https://fal.ai) |
| **Replicate API Key** | Optional | [replicate.com](https://replicate.com) |
| **W&B API Key** | For tracing | [wandb.ai/authorize](https://wandb.ai/authorize) |
| **W&B Team** | For tracing | Your W&B username or team name |

*At least one image generation API key is required.

## Usage

1. Open [neal.fun/infinite-craft](https://neal.fun/infinite-craft/)
2. Start crafting elements!
3. Watch as AI-generated backgrounds appear based on your creations
4. Check your [Weave dashboard](https://wandb.ai) to see the traces

## How It Works

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Infinite Craft │────▶│  LLM Prompt  │────▶│ Image Generator │
│   (elements)    │     │  Generation  │     │   (FAL/Replicate)│
└─────────────────┘     └──────────────┘     └─────────────────┘
                              │                      │
                              ▼                      ▼
                        ┌─────────────────────────────────┐
                        │         Weave Tracing           │
                        │   (tokens, latency, outputs)    │
                        └─────────────────────────────────┘
```

1. **Content Script** monitors the Infinite Craft page for new elements
2. **Background Service Worker** receives element updates
3. **LLM** generates a creative image prompt based on elements
4. **Image Model** creates the visual from the prompt
5. **Weave** traces every step for observability

## Model Comparison

One of the goals of this project is to make it easy to compare different image generation models. Currently supported:

| Provider | Model | Speed | Quality |
|----------|-------|-------|---------|
| FAL | z-image-turbo | ⚡ Fast | Good |
| Replicate | pruna-p-image | Medium | High |

Add more models by editing `apiHandler.js`!

## Project Structure

```
infinite-fun-extension/
├── manifest.json          # Chrome extension manifest (MV3)
├── background.js          # Service worker - orchestrates AI calls
├── weaveShim.js          # Browser-compatible Weave tracing
├── llmHandler.js         # LLM prompt generation
├── apiHandler.js         # Image generation APIs
├── nealFunContentScript.js   # Monitors Infinite Craft
├── options.html/js/css   # Extension settings page
├── popup.html/js/css     # Extension popup
└── images/               # Extension icons
```

## Contributing

PRs welcome! Some ideas:

- Add more image generation models
- Improve prompt engineering
- Add image history/gallery
- Support other creative games

## Credits

- [Infinite Craft](https://neal.fun/infinite-craft/) by [Neal Agarwal](https://twitter.com/nealagarwal)
- [Weave](https://weave-docs.wandb.ai/) by [Weights & Biases](https://wandb.ai)
- Built with ❤️ by [@altryne](https://twitter.com/altryne)

## License

MIT

