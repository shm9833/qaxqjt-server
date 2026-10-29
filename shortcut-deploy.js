const fs = require('fs');
const TAG = 'shortcut1016';
const MARKER = 'C:\\qaxqjt-frontend\\admin\\p-' + TAG + '-mark.txt';

const FILES = [
    {
        src: '\\\\tsclient\\D\\shortcut-prompt.js',
        dst: 'C:\\qaxqjt-frontend\\js\\shortcut-prompt.js',
        need: ['qaxqjt_shortcut_created', 'qaxqjt_shortcut_closed'],
        minBytes: 5000
    },
    {
        src: '\\\\tsclient\\D\\index.html',
        dst: 'C:\\qaxqjt-frontend\\index.html',
        need: ['shortcut-prompt.js'],
        minBytes: 30000
    },
    {
        src: '\\\\tsclient\\D\\self-portal.html',
        dst: 'C:\\qaxqjt-frontend\\admin\\self-portal.html',
        need: ['shortcut-prompt.js'],
        minBytes: 40000
    }
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
            return false;
        }
        const size = fs.statSync(f.src).size;
        if (size < f.minBytes) {
            log('FATAL: source too small: ' + f.src + ' (' + size + ' < ' + f.minBytes + ')');
            return false;
        }
        const content = fs.readFileSync(f.src, 'utf8');
        for (const n of f.need) {
            if (!content.includes(n)) {
                log('FATAL: feature string missing in ' + f.src + ': ' + n);
                return false;
            }
        }
        log('OK: ' + f.src + ' (' + size + ' bytes)');
    }
    return true;
}

function backup() {
    log('=== Backup existing files ===');
    for (const f of FILES) {
        if (fs.existsSync(f.dst)) {
            const bak = f.dst + '.bak-' + TAG;
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
    for (const f of FILES) {
        if (!fs.existsSync(f.dst)) {
            log('FATAL: dst missing: ' + f.dst);
            return false;
        }
        const content = fs.readFileSync(f.dst, 'utf8');
        for (const n of f.need) {
            if (!content.includes(n)) {
                log('FATAL: feature string missing in ' + f.dst + ': ' + n);
                return false;
            }
        }
        // Check for pollution
        if (content.includes('tsclient') || content.includes('copy /y')) {
            log('FATAL: pollution detected in ' + f.dst);
            return false;
        }
        log('OK: ' + f.dst);
    }
    return true;
}

function writeMarker(success, msg) {
    const status = success ? 'DONE' : 'FAILED';
    fs.writeFileSync(MARKER, status + ' ' + msg + ' ' + new Date().toISOString());
}

(function main() {
    try {
        if (!probe()) {
            writeMarker(false, 'probe failed');
            process.exit(1);
        }
        backup();
        copyFiles();
        if (!verify()) {
            writeMarker(false, 'verify failed');
            process.exit(1);
        }
        writeMarker(true, 'shortcut prompt deployed');
        log('=== SUCCESS ===');
    } catch (err) {
        writeMarker(false, err.message);
        log('=== FATAL: ' + err.message + ' ===');
        process.exit(1);
    }
})();
