// nealFunContentScript.js
console.log('Infinite Fun Extension: Content script loaded');
// This script monitors changes in the .instances div for elements with .item.instance classes on https://neal.fun/infinite-craft/
// and sends new text to the other tab on https://fastsdxl.ai/

// Function to send message to background script
// Function to send message to background script
let itemsContainer = null;
let previousTextsJson = '';

function sendMessageToBackground(message) {
  chrome.runtime.sendMessage(message);
}

// Function to extract text from elements and identify new text
function extractAndSendNewTexts() {
  // Check if container is still valid
  if (!itemsContainer || !itemsContainer.isConnected) {
      console.log('Infinite Fun Extension: Container missing or detached. Attempting to re-acquire...');
      const instance = document.querySelector('.instance');
      if (instance) {
          itemsContainer = instance.parentElement;
          console.log('Infinite Fun Extension: Re-acquired container', itemsContainer);
          // Re-attach observer
          observer.disconnect();
          observer.observe(itemsContainer, { childList: true, subtree: true });
      } else {
          console.log('Infinite Fun Extension: Could not find container.');
          return;
      }
  }

  const instanceElements = itemsContainer.querySelectorAll('.instance');
  const texts = [];
  const seenTexts = new Set();
  
  // Sort elements by position or just collect them. 
  // Since order matters for the prompt, we should probably keep them in DOM order.
  instanceElements.forEach(element => {
    // Ignore elements being dragged if they have a specific class (often 'dragging' or similar)
    if (element.classList.contains('dragging')) return;

    const id = element.id;
    const text = element.textContent.trim();
    if (!seenTexts.has(text)) {
      texts.push({ id, text });
      seenTexts.add(text);
    }
  });

  // Check if texts have changed
  const currentTextsJson = JSON.stringify(texts.map(t => t.text).sort());
  if (currentTextsJson === previousTextsJson) {
      console.log('Infinite Fun Extension: No changes in items, skipping update.');
      return;
  }

  previousTextsJson = currentTextsJson;

  //make sure that the items exist in the dom actually
  console.log('Infinite Fun Extension: Items changed, sending update:', texts);
  // Send the extracted texts to the background script
  sendMessageToBackground({ action: 'updateTexts', texts });
}


// Debounce function to limit the rate at which a function can fire
function debounce(func, wait) {
  let timeout;
  return function() {
    const context = this, args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

const debouncedExtractAndSendNewTexts = debounce(extractAndSendNewTexts, 1000); // 1000 ms debounce time

// Observer to monitor changes in the .instances div
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList') {
      debouncedExtractAndSendNewTexts();
    }
  });
});

// Start observing
// Function to start observing the target node
function startObserving() {
  console.log('Infinite Fun Extension: startObserving called');

  const setupContainer = (container) => {
      console.log('Infinite Fun Extension: Container found', container);
      itemsContainer = container;
      observer.observe(itemsContainer, { childList: true, subtree: true });
      debouncedExtractAndSendNewTexts();
  };

  // 1. Try to find an existing instance to get the container
  const existingInstance = document.querySelector('.instance');
  if (existingInstance) {
      setupContainer(existingInstance.parentElement);
      return;
  }

  // 2. If not found, observe body for the first instance
  console.log('Infinite Fun Extension: Waiting for instances...');
  const bodyObserver = new MutationObserver((mutations, me) => {
      for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) {
                  // Check if the node itself is an instance
                  if (node.classList.contains('instance')) {
                      setupContainer(node.parentElement);
                      me.disconnect();
                      return;
                  }
                  // Check if the node contains an instance
                  if (node.querySelector) {
                      const instance = node.querySelector('.instance');
                      if (instance) {
                          setupContainer(instance.parentElement);
                          me.disconnect();
                          return;
                      }
                  }
              }
          }
      }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

// Initialize observation
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving);
} else {
  startObserving();
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateBackground') {
    console.log('Infinite Fun Extension: Received background update', request.imageUrl.substring(0, 50) + '...');
    
    // Update the background of the page with the received image
    const imageUrl = `url("${request.imageUrl}")`;
    
    try {
        // Apply to body
        document.body.style.backgroundImage = imageUrl;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'left center'; // Shift to left to avoid right sidebar
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundAttachment = 'fixed';
        console.log('Infinite Fun Extension: Applied background to body');
    } catch (e) {
        console.error('Infinite Fun Extension: Error applying to body', e);
    }
    
    // Try to make sidebar transparent
    try {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            const applySidebarStyles = () => {
                sidebar.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
                sidebar.style.backdropFilter = 'blur(10px)';
                sidebar.style.borderLeft = '1px solid rgba(255, 255, 255, 0.3)';
            };
            
            applySidebarStyles();
            console.log('Infinite Fun Extension: Made sidebar transparent');

            // Observe style changes to persist transparency if width changes
            if (!sidebar.dataset.observing) {
                const sidebarObserver = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                            // Re-apply if background color is overwritten (check if it's not what we set)
                            if (sidebar.style.backgroundColor !== 'rgba(255, 255, 255, 0.5)') {
                                applySidebarStyles();
                            }
                        }
                    });
                });
                sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ['style'] });
                sidebar.dataset.observing = 'true';
            }
        }
    } catch (e) {
        console.error('Infinite Fun Extension: Error handling sidebar', e);
    }
    
    // Also try to apply to the main container if it exists and covers the body
    try {
        const container = document.querySelector('.container');
        if (container) {
            container.style.backgroundImage = imageUrl;
            container.style.backgroundSize = 'cover';
            container.style.backgroundPosition = 'center';
            container.style.backgroundRepeat = 'no-repeat';
            console.log('Infinite Fun Extension: Applied background to .container');
        }
    } catch (e) {
        console.error('Infinite Fun Extension: Error applying to container', e);
    }

    // Make canvas transparent so background shows through
    try {
        const canvas = document.querySelector('canvas');
        if (canvas) {
            canvas.style.backgroundColor = 'transparent';
            canvas.style.mixBlendMode = 'multiply';
            console.log('Infinite Fun Extension: Made canvas transparent');
        } else {
            console.log('Infinite Fun Extension: Canvas not found');
        }
    } catch (e) {
        console.error('Infinite Fun Extension: Error handling canvas', e);
    }

    // Display the prompt
    if (request.prompt) {
        let promptDiv = document.getElementById('infinite-fun-prompt');
        if (!promptDiv) {
            promptDiv = document.createElement('div');
            promptDiv.id = 'infinite-fun-prompt';
            promptDiv.style.position = 'fixed';
            promptDiv.style.bottom = '20px';
            promptDiv.style.left = '50%';
            promptDiv.style.transform = 'translateX(-50%)';
            promptDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            promptDiv.style.color = 'white';
            promptDiv.style.padding = '10px 20px';
            promptDiv.style.borderRadius = '5px';
            promptDiv.style.zIndex = '10000';
            promptDiv.style.maxWidth = '80%';
            promptDiv.style.textAlign = 'center';
            promptDiv.style.fontFamily = 'sans-serif';
            promptDiv.style.fontSize = '14px';
            promptDiv.style.fontSize = '14px';
            promptDiv.style.pointerEvents = 'auto'; // Enable clicks
            promptDiv.style.cursor = 'pointer';
            promptDiv.style.transition = 'opacity 0.3s';
            
            // Toggle opacity on click
            promptDiv.onclick = () => {
                if (promptDiv.style.opacity === '0.1') {
                    promptDiv.style.opacity = '1';
                } else {
                    promptDiv.style.opacity = '0.1';
                }
            };

            document.body.appendChild(promptDiv);
        }
        // Try to parse prompt as JSON for nicer display
        try {
            const promptObj = JSON.parse(request.prompt);
            let html = '<div style="text-align: left; font-size: 12px;">';
            for (const [key, value] of Object.entries(promptObj)) {
                html += `<strong>${key}:</strong> ${value}<br>`;
            }
            html += '</div>';
            promptDiv.innerHTML = html;
        } catch (e) {
            // Not JSON or parse error, display as text
            promptDiv.textContent = request.prompt;
        }
        
        if (request.stats) {
            const statsDiv = document.createElement('div');
            statsDiv.style.fontSize = '10px';
            statsDiv.style.marginTop = '5px';
            statsDiv.style.opacity = '0.8';
            statsDiv.textContent = `LLM: ${request.stats.llm}ms | Image Gen: ${request.stats.imageGen}ms | Total: ${request.stats.total}ms`;
            promptDiv.appendChild(statsDiv);
        }

        promptDiv.style.opacity = '1';
        
        // Optional: Fade out after a while
        // setTimeout(() => {
        //     promptDiv.style.opacity = '0';
        // }, 10000);
    }
  }
});

