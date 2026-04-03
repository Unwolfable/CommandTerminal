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

// ===== PASSWORD SYSTEM =====
let systemPassword = localStorage.getItem('nxos_password');
let isLocked = !systemPassword;
let loginInput = '';

// ===== HASH PASSWORD =====
async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

  if (isLocked) {
    const div = document.createElement('div');
    div.textContent =
      'Set a system password: ' +
      '*'.repeat(loginInput.length) +
      (cursorVisible ? '_' : '');
    div.style.color = 'yellow';
    terminal.appendChild(div);
    return;
  }

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
  localStorage.removeItem('nxos_password');
  systemPassword = null;
  isLocked = true;
  loginInput = '';

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
  const cwd = getCWD();
  const file = cwd.children[fileName];

  if (!file) return addLine(`open: ${fileName} not found`, 'red');
  if (file.type !== 'text') return addLine('open: not a file', 'red');
  if (!fileName.toLowerCase().endsWith('.html'))
    return addLine('open: can only open HTML files', 'red');

  const win = document.createElement('div');
  win.className = 'draggable resizable';
  win.style.top = '100px';
  win.style.left = '100px';
  win.style.position = 'absolute';
  win.style.zIndex = 1000;
  win.style.background = '#111';
  win.style.border = '1px solid #555';
  win.style.width = '700px';
  win.style.height = '500px';
  win.style.display = 'flex';
  win.style.flexDirection = 'column';
  win.style.resize = 'both';
  win.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.style.background = '#222';
  header.style.color = 'white';
  header.style.padding = '5px';
  header.style.cursor = 'move';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const title = document.createElement('span');
  title.textContent = fileName;

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '5px';

  const fullBtn = document.createElement('button');
  fullBtn.textContent = '⬜';
  fullBtn.style.background = '#222';
  fullBtn.style.color = 'white';
  fullBtn.style.border = 'none';
  fullBtn.style.cursor = 'pointer';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'X';
  closeBtn.style.background = '#222';
  closeBtn.style.color = 'white';
  closeBtn.style.border = 'none';
  closeBtn.style.cursor = 'pointer';

  controls.appendChild(fullBtn);
  controls.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(controls);
  win.appendChild(header);

  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.srcdoc = file.content;
  win.appendChild(iframe);
  document.body.appendChild(win);

  let isFull = false;
  let prev = {};

  fullBtn.onclick = () => {
    if (!isFull) {
      // save previous size/position
      prev = {
        width: win.offsetWidth + 'px',
        height: win.offsetHeight + 'px',
        top: win.offsetTop + 'px',
        left: win.offsetLeft + 'px',
      };
      win.style.top = '0px';
      win.style.left = '0px';
      win.style.width = window.innerWidth + 'px';
      win.style.height = window.innerHeight + 'px';
      win.style.resize = 'none';
    } else {
      // restore
      win.style.top = prev.top;
      win.style.left = prev.left;
      win.style.width = prev.width;
      win.style.height = prev.height;
      win.style.resize = 'both';
    }
    isFull = !isFull;
  };

  closeBtn.onclick = () => win.remove();

  // ===== MOVE LOGIC =====
  header.onmousedown = (e) => {
    if (isFull) return; // cannot move when maximized
    let offsetX = e.clientX - win.offsetLeft;
    let offsetY = e.clientY - win.offsetTop;

    function move(e) {
      win.style.left = e.clientX - offsetX + 'px';
      win.style.top = e.clientY - offsetY + 'px';
    }
    function stop() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
    }

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    e.preventDefault();
  };
}

// ===== COMMANDS =====
function runCommand(cmd) {
  if (!cmd.trim()) return;

  if (isLocked) {
    addLine('Please set your system password first.', 'red');
    return;
  }

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
    case 'help': {
      [
        'cd [dir]            - Change the current directory',
        'ls                  - List files and directories in the current directory',
        'pwd                 - Show the current path',
        'cat [file]          - Display the contents of a text file',
        'echo [text]         - Print text or write to a file using >',
        'mkdir [dir]         - Create a new directory',
        'touch [file]        - Create a new empty file',
        'rm [file]           - Delete a file',
        'rmdir [dir]         - Delete a directory and all contents recursively',
        'mv [src] [dest]     - Rename or move a file',
        'cp [src] [dest]     - Copy a file or directory',
        'export [path]       - Download a file or directory',
        'import [file/folder]- Upload a file or folder (no zips allowed)',
        'history             - Show previously entered commands',
        'clear               - Clear the terminal screen',
        'open [file.html]    - Open an HTML file in a draggable window',
      ].forEach((c) => addLine(c, 'green'));
      break;
    }

    case 'cd': {
      if (!args[1]) {
        fs.cwd = ['root'];
        break;
      }
      let dirPath = args.slice(1).join(' ').replace(/^"|"$/g, '');
      let newPath = resolvePath(dirPath);
      let target = getDir(newPath);
      if (!target || target.type !== 'dir') {
        addLine('cd: no such directory', 'red');
        break;
      }
      fs.cwd = newPath;
      break;
    }

    case 'ls': {
      Object.keys(cwd.children).forEach((name) =>
        addLine(
          cwd.children[name].type === 'dir'
            ? '[DIR] ' + name
            : '[FILE] ' + name,
          'green'
        )
      );
      break;
    }

    case 'pwd': {
      addLine(getPath(), 'green');
      break;
    }

    case 'cat': {
      if (!args[1] || !cwd.children[args[1]])
        return addLine('cat: not found', 'red');
      addLine(cwd.children[args[1]].content, 'green');
      break;
    }

    case 'mkdir': {
      if (!args[1]) return addLine('mkdir: missing directory name', 'red');
      let parts = args[1].split(/\\|\//).filter(Boolean);
      let parentPath =
        parts.length > 1
          ? resolvePath(parts.slice(0, -1).join('\\'))
          : [...fs.cwd];
      let mkdirDirName = parts[parts.length - 1];
      let parent = getDir(parentPath);
      if (!parent) return addLine('mkdir: invalid path', 'red');
      if (parent.children[mkdirDirName])
        return addLine('mkdir: directory already exists', 'red');
      parent.children[mkdirDirName] = { type: 'dir', children: {} };
      break;
    }

    case 'touch': {
      if (!args[1]) return addLine('touch: missing file name', 'red');
      let tParts = args[1].split(/\\|\//).filter(Boolean);
      let tParentPath =
        tParts.length > 1
          ? resolvePath(tParts.slice(0, -1).join('\\'))
          : [...fs.cwd];
      let touchFileName = tParts[tParts.length - 1];
      let tParent = getDir(tParentPath);
      if (!tParent) return addLine('touch: invalid path', 'red');
      if (tParent.children[touchFileName])
        return addLine('touch: file exists', 'red');
      tParent.children[touchFileName] = { type: 'text', content: '' };
      break;
    }

    case 'rm': {
      if (!args[1] || !cwd.children[args[1]])
        return addLine('rm: not found', 'red');
      if (cwd.children[args[1]].type === 'dir')
        return addLine('rm: cannot remove directory, use rmdir', 'red');
      delete cwd.children[args[1]];
      break;
    }

    case 'rmdir': {
      if (!args[1]) return addLine('rmdir: missing directory', 'red');
      let rmdirDirName = args.slice(1).join(' ').replace(/^"|"$/g, '');
      let targetDir = resolvePath(rmdirDirName);
      let parentDir = getDir(targetDir.slice(0, -1));
      let baseName = targetDir[targetDir.length - 1];
      if (!parentDir || !parentDir.children[baseName])
        return addLine('rmdir: directory not found', 'red');
      if (parentDir.children[baseName].type !== 'dir')
        return addLine('rmdir: not a directory', 'red');

      function deleteDirRecursive(dir) {
        for (let key in dir.children) {
          if (dir.children[key].type === 'dir')
            deleteDirRecursive(dir.children[key]);
        }
        dir.children = {};
      }

      deleteDirRecursive(parentDir.children[baseName]);
      delete parentDir.children[baseName];
      addLine(`Directory "${baseName}" deleted`, 'green');
      break;
    }

    case 'mv': {
      if (!args[1] || !args[2]) return addLine('mv: missing arguments', 'red');
      let srcPath = resolvePath(args[1]);
      let destPath = resolvePath(args[2]);
      let srcParent = getDir(srcPath.slice(0, -1));
      let destParent = getDir(destPath.slice(0, -1));
      let srcName = srcPath[srcPath.length - 1];
      let destName = destPath[destPath.length - 1];
      if (!srcParent || !srcParent.children[srcName])
        return addLine('mv: source not found', 'red');
      if (!destParent || destParent.children[destName])
        return addLine('mv: destination exists', 'red');
      destParent.children[destName] = srcParent.children[srcName];
      delete srcParent.children[srcName];
      break;
    }

    case 'cp': {
      if (!args[1] || !args[2]) return addLine('cp: missing arguments', 'red');
      let cSrcPath = resolvePath(args[1]);
      let cDestPath = resolvePath(args[2]);
      let cSrcParent = getDir(cSrcPath.slice(0, -1));
      let cDestParent = getDir(cDestPath.slice(0, -1));
      let cSrcName = cSrcPath[cSrcPath.length - 1];
      let cDestName = cDestPath[cDestPath.length - 1];
      if (!cSrcParent || !cSrcParent.children[cSrcName])
        return addLine('cp: source not found', 'red');
      if (!cDestParent || cDestParent.children[cDestName])
        return addLine('cp: destination exists', 'red');
      cDestParent.children[cDestName] = JSON.parse(
        JSON.stringify(cSrcParent.children[cSrcName])
      );
      break;
    }

    case 'clear': {
      lines = [];
      break;
    }

    case 'open': {
      if (!args[1]) return addLine('open: missing file', 'red');
      openFile(args[1]);
      break;
    }

    case 'history': {
      history.forEach((h, i) => addLine(`${i + 1} ${h}`, 'green'));
      break;
    }

    case 'export': {
      if (!args[1]) return addLine('export: missing path', 'red');
      exportFS(args[1]);
      break;
    }

    case 'import': {
      let importPath = args[1];
      if (!importPath) {
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.multiple = true;
        input.onchange = (e) => {
          const files = Array.from(e.target.files);
          if (!files.length) return addLine('No files selected', 'red');

          let cwd = getCWD();
          files.forEach((file) => {
            if (file.name.toLowerCase().endsWith('.zip')) {
              addLine(`Skipping zip file: ${file.name}`, 'yellow');
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
              const pathParts = file.webkitRelativePath
                ? file.webkitRelativePath.split('/')
                : [file.name];
              let parent = cwd;
              for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (!parent.children[part])
                  parent.children[part] = { type: 'dir', children: {} };
                parent = parent.children[part];
              }
              parent.children[pathParts[pathParts.length - 1]] = {
                type: 'text',
                content: ev.target.result,
              };
              saveState();
            };
            reader.readAsText(file);
          });
          addLine(`Imported ${files.length} file(s)`, 'green');
        };
        input.click();
      } else {
        addLine(
          'import: please use drag & drop or select files without specifying path',
          'red'
        );
      }
      break;
    }

    default:
      addLine('command not found', 'red');
  }

  history.push(cmd);
  historyIndex = history.length;
  if (history.length > MAX_HISTORY) history.shift();
  saveState();
  render();
}

// ===== INPUT =====
document.addEventListener('keydown', async (e) => {
  if (isLocked) {
    if (e.key === 'Enter') {
      if (!loginInput.trim()) return;
      systemPassword = await hashPassword(loginInput);
      localStorage.setItem('nxos_password', systemPassword);
      isLocked = false;
      loginInput = '';
      addLine('Password set. Welcome!', 'green');
      render();
      return;
    }
    if (e.key === 'Backspace') {
      loginInput = loginInput.slice(0, -1);
      render();
      return;
    }
    if (e.key.length === 1) {
      loginInput += e.key;
      render();
    }
    return;
  }

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
