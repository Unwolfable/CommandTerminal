const terminal = document.getElementById('terminal');
const MAX_VISIBLE_LINES = 500;
const MAX_HISTORY = 100;

// ===== STATE =====
let lines = [];
let currentInput = '';
let history = [];
let historyIndex = 0;
let defaultChildren = {};

let fs = { root: { type: 'dir', children: {} }, cwd: ['root'] };

// ===== EXPORT FILES / DIRECTORY WITH AUTO EXTENSIONS =====
function exportFS(path) {
  const resolvedPath = resolvePath(path);
  const targetName = resolvedPath[resolvedPath.length - 1];
  const parentDir = getDir(resolvedPath.slice(0, -1));

  if (!parentDir) return addLine(`export: invalid path`, 'red');

  const target = parentDir.children[targetName];

  if (!target) return addLine(`export: ${path} not found`, 'red');

  // If it's a file
  if (target.type === 'text') {
    let downloadName = targetName;
    if (!/\.[a-zA-Z0-9]+$/.test(downloadName)) {
      downloadName += '.txt'; // default extension if none
    }
    const blob = new Blob([target.content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = downloadName;
    a.click();
    addLine(`File exported: ${downloadName}`, 'green');
    return;
  }

  // If it's a directory
  if (target.type === 'dir') {
    const zip = new JSZip();

    function addDirToZip(dir, zipObj) {
      for (let key in dir.children) {
        if (dir.children[key].type === 'dir') {
          const subFolder = zipObj.folder(key);
          addDirToZip(dir.children[key], subFolder);
        } else if (dir.children[key].type === 'text') {
          let fname = key;
          if (!/\.[a-zA-Z0-9]+$/.test(fname)) fname += '.txt';
          zipObj.file(fname, dir.children[key].content);
        }
      }
    }

    addDirToZip(target, zip);

    zip.generateAsync({ type: 'blob' }).then((content) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = targetName + '.zip';
      a.click();
      addLine(`Directory exported: ${targetName}.zip`, 'green');
    });
    return;
  }
}

// ===== SAVE / LOAD =====
function saveState() {
  try {
    const fsCopy = JSON.parse(JSON.stringify(fs));
    fsCopy.cwd = fs.cwd;
    localStorage.setItem('nxos_save', JSON.stringify({ fs: fsCopy, history }));
  } catch (e) {
    console.error(e);
  }
}

// ===== BUILD / MERGE FILESYSTEM =====
function buildFS(obj) {
  let dir = { type: 'dir', children: {} };
  for (let key in obj) {
    if (typeof obj[key] === 'object') {
      dir.children[key] = buildFS(obj[key]);
    } else {
      dir.children[key] = { type: 'text', content: obj[key] };
    }
  }
  return dir;
}

function mergeDirectories(target, source) {
  for (let key in source) {
    if (!target[key]) {
      target[key] = JSON.parse(JSON.stringify(source[key]));
    } else if (target[key].type === 'dir' && source[key].type === 'dir') {
      mergeDirectories(target[key].children, source[key].children);
    }
  }
}

// ===== DEFAULT FILES =====
async function loadDefaultFiles() {
  const fileList = [];
  const files = {};
  for (let f of fileList) {
    try {
      const content = await fetch(`Files/${f}`).then((r) => r.text());
      files[f] = { type: 'text', content };
    } catch {
      files[f] = { type: 'text', content: '' };
    }
  }
  return files;
}

// ===== INIT FILESYSTEM =====
async function initFS() {
  const newDefaults = await loadDefaultFiles();
  defaultChildren = newDefaults;

  const saved = localStorage.getItem('nxos_save');

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      fs = parsed.fs || { root: { type: 'dir', children: {} }, cwd: ['root'] };
      fs.cwd = parsed.fs?.cwd || ['root'];
      history = parsed.history || [];
      mergeDirectories(fs.root.children, newDefaults);
    } catch {
      fs = { root: { type: 'dir', children: newDefaults }, cwd: ['root'] };
    }
  } else {
    fs = { root: { type: 'dir', children: newDefaults }, cwd: ['root'] };
  }

  saveState();
}

// ===== HELPERS =====
function normalizePath(path) {
  return path.replace(/\//g, '\\');
}

function readFile(filename) {
  let cwd = getCWD();
  let file = cwd.children[filename];
  if (!file || file.type !== 'text') return null;
  return file.content;
}

function writeFile(filename, content) {
  let cwd = getCWD();
  let file = cwd.children[filename];
  if (!file || file.type !== 'text') return false;
  file.content = content;
  saveState();
  return true;
}

function resolvePath(path) {
  path = normalizePath(path);
  let parts = path.split('\\').filter(Boolean);
  let newPath =
    path.startsWith('C:\\') || path.startsWith('/') ? ['root'] : [...fs.cwd];

  for (let part of parts) {
    if (part === '~') {
      newPath = ['root'];
    } else if (part === '..') {
      if (newPath.length > 1) newPath.pop();
    } else {
      newPath.push(part);
    }
  }
  return newPath;
}

function getDir(pathArr = fs.cwd) {
  let dir = fs.root;
  for (let i = 1; i < pathArr.length; i++) {
    if (!dir.children[pathArr[i]]) return null;
    dir = dir.children[pathArr[i]];
  }
  return dir;
}

function getCWD() {
  return getDir(fs.cwd);
}

function getPath() {
  let subPath = fs.cwd.slice(1).join('\\');
  return `C:\\Users\\terminal457${subPath ? '\\' + subPath : ''}`;
}

function getPrompt() {
  return `${getPath()}>`;
}

// ===== OUTPUT =====
function addLine(text, color = 'lime') {
  lines.push({ text, color });
  if (lines.length > MAX_VISIBLE_LINES) lines.shift();
  render();
}

// ===== CURSOR =====
let cursorVisible = true;
setInterval(() => {
  cursorVisible = !cursorVisible;
  render();
}, 500);

// ===== RENDER =====
function render() {
  terminal.innerHTML = '';

  lines.forEach((l) => {
    const div = document.createElement('div');
    div.textContent = l.text;
    div.style.color = l.color;
    terminal.appendChild(div);
  });

  const inputLine = document.createElement('div');
  const cursor = cursorVisible ? '_' : ' ';
  inputLine.textContent = `${getPrompt()} ${currentInput}${cursor}`;
  inputLine.style.color = 'white';
  terminal.appendChild(inputLine);

  terminal.scrollTop = terminal.scrollHeight;
}

// ===== RESET =====
function factoryReset() {
  fs = {
    root: {
      type: 'dir',
      children: JSON.parse(JSON.stringify(defaultChildren)),
    },
    cwd: ['root'],
  };

  history = [];
  lines = [];
  localStorage.removeItem('nxos_save');

  addLine('System has been reset to factory settings.', 'green');
  render();
}

// ===== OPEN FILE =====
function openFile(fileName) {
  // ... your draggable/resizable popup logic unchanged
}

// ===== COMMANDS =====
function runCommand(cmd) {
  if (!cmd.trim()) return;

  let cwd = getCWD();
  let args = cmd.trim().split(/\s+/);
  let command = args[0]?.toLowerCase();

  addLine(`${getPrompt()} ${cmd}`, 'white');

  if (cmd.includes('>')) {
    let [left, right] = cmd.split('>');
    let filename = right.trim();

    if (cwd.children[filename]) {
      return addLine('File exists (no overwrite)', 'red');
    }

    let content = left
      .replace(/^echo\s+/, '')
      .trim()
      .replace(/^"|"$/g, '');
    cwd.children[filename] = { type: 'text', content };
    addLine(`Wrote to ${filename}`, 'green');
    saveState();
    return;
  }

  switch (command) {
    // ... all commands unchanged
  }

  history.push(cmd);
  historyIndex = history.length;
  if (history.length > MAX_HISTORY) history.shift();
  saveState();
  render();
}

// ===== INPUT =====
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    let matches = Object.keys(getCWD().children).filter((name) =>
      name.startsWith(currentInput)
    );
    if (matches.length === 1) currentInput = matches[0];
    render();
    return;
  }

  if (e.key === 'Enter') {
    runCommand(currentInput);
    currentInput = '';
    render();
    return;
  }

  if (e.key === 'Backspace') {
    currentInput = currentInput.slice(0, -1);
    render();
    return;
  }

  if (e.key === 'ArrowUp') {
    if (historyIndex > 0)
      historyIndex--, (currentInput = history[historyIndex]);
    render();
    return;
  }

  if (e.key === 'ArrowDown') {
    if (historyIndex < history.length - 1)
      historyIndex++, (currentInput = history[historyIndex]);
    else currentInput = '';
    render();
    return;
  }

  if (e.key.length === 1) {
    currentInput += e.key;
    render();
  }
});

// ===== INIT =====
(async () => {
  addLine('ALE NXOS [Version 1.0.0]', 'cyan');
  addLine(
    '(c) 2026 Artificial Labs & Engineering. All rights reserved.',
    'cyan'
  );
  addLine('', 'cyan');
  addLine('Initializing virtual filesystem...', 'yellow');

  try {
    await initFS();
  } catch (e) {
    addLine('Error initializing filesystem: ' + e.message, 'red');
  }

  render();
})();
