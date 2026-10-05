// Small independent bootstrap: module failures must leave a useful retry screen.
const failed = () => {
  const label = document.getElementById('loadState');
  if (label)
    label.textContent =
      'The circuit could not load. Check your connection and reload.';
  document.getElementById('retry').hidden = false;
};
document
  .getElementById('retry')
  .addEventListener('click', () => location.reload());
document
  .getElementById('reloadGame')
  .addEventListener('click', () => location.reload());
const watchdog = setTimeout(() => {
  if (document.getElementById('startBtn').disabled) failed();
}, 15000);
import(document.querySelector('meta[name="game-module"]').content)
  .then(() => clearTimeout(watchdog))
  .catch((error) => {
    clearTimeout(watchdog);
    console.error(error);
    failed();
  });
