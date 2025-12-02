// popup.js

// Saves options to chrome.storage
const saveOptions = () => {
    const openaiApiKey = document.getElementById('openaiApiKey').value;
    const falApiKey = document.getElementById('falApiKey').value;
    const replicateApiKey = document.getElementById('replicateApiKey').value;
    const imageModel = document.getElementById('imageModel').value;

    chrome.storage.sync.set(
        { openaiApiKey, falApiKey, replicateApiKey, imageModel },
        () => {
            // Update status to let user know options were saved.
            const status = document.getElementById('status-message');
            status.textContent = 'Settings saved.';
            status.style.color = 'green';
            setTimeout(() => {
                status.textContent = '';
            }, 2000);

            // Notify background script to regenerate image with new settings
            chrome.runtime.sendMessage({ action: 'regenerateImage' });
        }
    );
};

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
const restoreOptions = () => {
    chrome.storage.sync.get(
        { 
            openaiApiKey: '', 
            falApiKey: '', 
            replicateApiKey: '', 
            imageModel: 'fal-z-image-turbo' 
        },
        (items) => {
            document.getElementById('openaiApiKey').value = items.openaiApiKey;
            document.getElementById('falApiKey').value = items.falApiKey;
            document.getElementById('replicateApiKey').value = items.replicateApiKey;
            document.getElementById('imageModel').value = items.imageModel;
        }
    );
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save-settings').addEventListener('click', saveOptions);
