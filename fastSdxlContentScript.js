// Assuming that the message passing setup and API handling are correctly implemented in background.js and apiHandler.js

// Function to update the input box and trigger the image update
function updateInputAndFetchImage(newText) {
    const inputBox = document.querySelector('input[type="text"]'); // Adjust the selector based on the actual input box
    if (inputBox) {
        inputBox.value = newText;
        inputBox.dispatchEvent(new Event('input', { bubbles: true })); // Trigger the input event to update the image

        // Wait for the image to update. This could be improved with a more reliable event or mutation observer
        setTimeout(() => {
            const imgTag = document.querySelector('img'); // Adjust the selector based on the actual img tag
            if (imgTag) {
                const imageData = imgTag.src;
                if (imageData.startsWith('data:image')) {
                    // Send the base64 image data back to the neal.fun tab
                    chrome.runtime.sendMessage({action: "updateBackground", imageData: imageData}, response => {
                        console.log("Background updated", response);
                    });
                }
            }
        }, 3000); // Adjust timeout based on how long the image typically takes to update
    }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendTextForImageUpdate") {
        updateInputAndFetchImage(request.text);
        sendResponse({status: "Text received and input updated"});
    }
});

