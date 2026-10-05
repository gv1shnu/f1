export function bindInput(target, { active, input, camera, respawn, mute }) {
  const map = {
    KeyW: 'throttle',
    ArrowUp: 'throttle',
    KeyS: 'brake',
    ArrowDown: 'brake',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
    Space: 'handbrake',
  };
  const held = new Set();
  const sync = () => {
    for (const action of Object.keys(input))
      input[action] = [...held].some((key) => map[key] === action);
  };
  const clear = () => {
    held.clear();
    sync();
  };
  const editable = (e) =>
    e.target?.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target?.tagName);
  target.addEventListener('keydown', (e) => {
    if (!active() || editable(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (map[e.code]) {
      held.add(e.code);
      sync();
      e.preventDefault();
    }
    if (e.repeat) return;
    if (e.code === 'KeyC') camera();
    if (e.code === 'KeyR') respawn();
    if (e.code === 'KeyM') mute();
  });
  target.addEventListener('keyup', (e) => {
    held.delete(e.code);
    sync();
  });
  target.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  return clear;
}
