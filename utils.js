// utils.js
// This file contains utility functions that can be used across the extension

/**
 * Function to check if a given URL matches a specific pattern
 * @param {string} url - The URL to check
 * @param {string} pattern - The pattern to match against the URL
 * @returns {boolean} - True if the URL matches the pattern, false otherwise
 */
function urlMatchesPattern(url, pattern) {
    const regex = new RegExp(pattern);
    return regex.test(url);
}

/**
 * Function to debounce another function. It limits the rate at which a function can fire.
 * @param {Function} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @returns {Function} - A debounced version of the given function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Function to format image data for sending. Prepares base64 image data by ensuring correct format.
 * @param {string} imageData - The base64 encoded image data
 * @returns {string} - Correctly formatted image data URL
 */
function formatImageData(imageData) {
    if (!imageData.startsWith('data:image')) {
        return `data:image/jpeg;base64,${imageData}`;
    }
    return imageData;
}

/**
 * Function to extract the hostname from a URL
 * @param {string} url - The URL from which to extract the hostname
 * @returns {string} - The hostname of the URL
 */
function extractHostname(url) {
    let hostname;
    //find & remove protocol (http, ftp, etc.) and get hostname
    if (url.indexOf("://") > -1) {
        hostname = url.split('/')[2];
    } else {
        hostname = url.split('/')[0];
    }
    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];

    return hostname;
}

// Exporting the utility functions to be used in other scripts
export { urlMatchesPattern, debounce, formatImageData, extractHostname };
