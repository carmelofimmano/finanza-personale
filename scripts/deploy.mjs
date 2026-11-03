// Pubblica dist/ sul ramo gh-pages del repository, da cui GitHub Pages serve l'app.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const remote = execSync('git remote get-url origin').toString().trim();

writeFileSync('dist/.nojekyll', '');
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "Pubblica"', 'dist');
run(`git push -f -q ${remote} gh-pages`, 'dist');
console.log('Pubblicato. GitHub Pages si aggiorna in circa un minuto.');
