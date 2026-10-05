// Creates an isolated recording build; the regular gameplay entry is unchanged.
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { build } from 'esbuild';
import { createGameServer } from '../server.js';
import path from 'node:path';
const output = path.resolve('recordings');
const buildDir = path.join(output, '.build');
await mkdir(buildDir, { recursive: true });
let main = await readFile('public/js/main.js', 'utf8');
main =
  "import { createSession } from '../../scripts/simulation/session.js';\n" +
  main;
main = main.replace(
  'let car = new Car(track, Math.floor(Math.random() * 6));',
  'let car = new Car(track, 2);',
);
main = main.replace(
  'const drive = car.update(dt, input);',
  'const drive = simulation.update(dt);',
);
main = main.replace(
  'renderer.render(scene, camera);',
  'renderer.render(scene, camera);\n    simulation.frame(now);',
);
main = main.replace(
  'nameInput.value = `Driver${Math.floor(Math.random() * 900 + 100)}`;',
  "nameInput.value = 'POV Driver';",
);
main = main.replace(
  'if (elapsed > stepper.step * stepper.maxSteps) car.invalidateLap();',
  '/* Recording uses shared simulation time, independent of capture stalls. */',
);
main = main.replace(
  'if (running) car.invalidateLap();',
  '/* Recording pauses without invalidating the simulated race. */',
);
main += '\nconst simulation=createSession({car,net,track,renderer,audio});\n';
await build({
  stdin: {
    contents: main,
    resolveDir: path.resolve('public/js'),
    sourcefile: 'recording-entry.js',
  },
  bundle: true,
  format: 'esm',
  outfile: path.join(buildDir, 'game.js'),
});
let html = await readFile('public/index.html', 'utf8');
html = html.replace('./js/main.js', './game.js');
await writeFile(path.join(buildDir, 'index.html'), html);
await cp('public/css', path.join(buildDir, 'css'), { recursive: true });
await cp('public/audio', path.join(buildDir, 'audio'), { recursive: true });
await cp('public/js/boot.js', path.join(buildDir, 'boot.js'));
const game = createGameServer({
  publicDir: buildDir,
  maxClients: 3,
  roomCapacity: 3,
});
const [normal] = game.server.listeners('request');
game.server.removeAllListeners('request');
game.server.on('request', async (req, res) => {
  if (
    req.method === 'POST' &&
    (req.url === '/capture' || req.url === '/capture-summary')
  ) {
    try {
      await pipeline(
        req,
        createWriteStream(
          path.join(
            output,
            req.url === '/capture'
              ? 'three-client-race.webm'
              : 'three-client-race.json',
          ),
        ),
      );
      res.writeHead(200);
      res.end('Saved');
      console.log(req.url + ' saved');
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end('Failed');
    }
    return;
  }
  normal(req, res);
});
game.server.listen(3200, '127.0.0.1', () =>
  console.log('Recording game ready at http://127.0.0.1:3200'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => game.close().then(() => process.exit(0)));
