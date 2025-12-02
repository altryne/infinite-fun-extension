// options.js

// Saves options to chrome.storage
const saveOptions = () => {
  const monitorFrequency = document.getElementById('monitorFrequency').value;
  const emphasisStyle = document.getElementById('emphasisStyle').value;
  const openaiApiKey = document.getElementById('openaiApiKey').value;
  const falApiKey = document.getElementById('falApiKey').value;
  const replicateApiKey = document.getElementById('replicateApiKey').value;
  const llmModel = document.getElementById('llmModel').value;
  const wandbApiKey = document.getElementById('wandbApiKey').value;
  const wandbTeam = document.getElementById('wandbTeam').value;
  const weaveProject = document.getElementById('weaveProject').value;

  chrome.storage.sync.set(
    {
      monitorFrequency: monitorFrequency,
      emphasisStyle: emphasisStyle,
      openaiApiKey: openaiApiKey,
      falApiKey: falApiKey,
      replicateApiKey: replicateApiKey,
      llmModel: llmModel,
      wandbApiKey: wandbApiKey,
      wandbTeam: wandbTeam,
      weaveProject: weaveProject
    },
    () => {
      // Update status to let user know options were saved.
      const status = document.createElement('div');
      status.textContent = '✓ Options saved';
      status.style.cssText = `
        margin-top: 12px;
        padding: 10px 16px;
        background: #ecfdf5;
        color: #047857;
        border-radius: 8px;
        font-size: 14px;
        text-align: center;
      `;
      document.getElementById('optionsForm').appendChild(status);
      setTimeout(() => {
        status.remove();
      }, 2000);
    }
  );
};

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
const restoreOptions = () => {
  chrome.storage.sync.get(
    { 
      monitorFrequency: 5000, 
      emphasisStyle: 'bold', 
      openaiApiKey: '', 
      falApiKey: '', 
      replicateApiKey: '',
      llmModel: 'gpt-4o-mini', 
      wandbApiKey: '',
      wandbTeam: '',
      weaveProject: 'infinite-fun'
    },
    (items) => {
      document.getElementById('monitorFrequency').value = items.monitorFrequency;
      document.getElementById('emphasisStyle').value = items.emphasisStyle;
      document.getElementById('openaiApiKey').value = items.openaiApiKey;
      document.getElementById('falApiKey').value = items.falApiKey;
      document.getElementById('replicateApiKey').value = items.replicateApiKey;
      document.getElementById('llmModel').value = items.llmModel;
      document.getElementById('wandbApiKey').value = items.wandbApiKey;
      document.getElementById('wandbTeam').value = items.wandbTeam;
      document.getElementById('weaveProject').value = items.weaveProject;
    }
  );
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('optionsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveOptions();
});
