const fs = require('fs');
const path = require('path');
const http = require('http');

const TS = Date.now();
const BACKUP_SUFFIX = '.bak-shortcut-' + TS;
const MARKER = 'C:\\qaxqjt-frontend\\admin\\shortcut-deploy-' + TS + '-mark.txt';

const FILES = [
    { src: '\\\\tsclient\\D\\shortcut-prompt.js', dst: 'C:\\qaxqjt-frontend\\js\\shortcut-prompt.js' },
    { src: '\\\\tsclient\\D\\index.html', dst: 'C:\\qaxqjt-frontend\\index.html' },
    { src: '\\\\tsclient\\D\\self-portal.html', dst: 'C:\\qaxqjt-frontend\\admin\\self-portal.html' }
];

function log(msg) {
    const line = '[' + new Date().toISOString() + '] ' + msg;
    console.log(line);
}

function probe() {
    log('=== Probe source files ===');
    for (const f of FILES) {
        if (!fs.existsSync(f.src)) {
            log('FATAL: source missing: ' + f.src);
            process.exit(1);
        }
        log('OK: ' + f.src);
    }
}

function backup() {
    log('=== Backup existing files ===');
    for (const f of FILES) {
        if (fs.existsSync(f.dst)) {
            const bak = f.dst + BACKUP_SUFFIX;
            fs.copyFileSync(f.dst, bak);
            log('Backed up: ' + f.dst);
        } else {
            log('New file: ' + f.dst);
        }
    }
}

function copyFiles() {
    log('=== Copy files ===');
    for (const f of FILES) {
        fs.copyFileSync(f.src, f.dst);
        log('Copied: ' + f.dst);
    }
}

function verify() {
    log('=== Verify ===');
    // Check new file exists and has content
    const jsPath = 'C:\\qaxqjt-frontend\\js\\shortcut-prompt.js';
    if (!fs.existsSync(jsPath)) {
        log('FATAL: shortcut-prompt.js not found');
        return false;
    }
    const content = fs.readFileSync(jsPath, 'utf8');
    if (!content.includes('qaxqjt_shortcut_created')) {
        log('FATAL: marker not found in shortcut-prompt.js');
        return false;
    }
    log('shortcut-prompt.js verified');

    // Check index.html references
    const indexPath = 'C:\\qaxqjt-frontend\\index.html';
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    if (!indexContent.includes('shortcut-prompt.js')) {
        log('FATAL: shortcut-prompt.js not referenced in index.html');
        return false;
    }
    log('index.html verified');

    // Check self-portal.html references
    const spPath = 'C:\\qaxqjt-frontend\\admin\\self-portal.html';
    const spContent = fs.readFileSync(spPath, 'utf8');
    if (!spContent.includes('shortcut-prompt.js')) {
        log('FATAL: shortcut-prompt.js not referenced in self-portal.html');
        return false;
    }
    log('self-portal.html verified');

    return true;
}

function writeMarker(success, msg) {
    const status = success ? 'DONE' : 'FATAL';
    fs.writeFileSync(MARKER, status + ' ' + msg + ' ' + new Date().toISOString());
}

(async function main() {
    try {
        probe();
        backup();
        copyFiles();
        if (verify()) {
            writeMarker(true, 'shortcut prompt deployed');
            log('=== SUCCESS ===');
        } else {
            writeMarker(false, 'verify failed');
            log('=== FAILED: verify ===');
            process.exit(1);
        }
    } catch (err) {
        writeMarker(false, err.message);
        log('=== FATAL: ' + err.message + ' ===');
        process.exit(1);
    }
})();
