chrome.commands.onCommand.addListener((command) => {
  if (command === "start") chrome.storage.local.set({ enabled: true });
  if (command === "stop") chrome.storage.local.set({ enabled: false });
});
