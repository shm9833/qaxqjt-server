const fs = require('fs');

const TAG = 'ripple1016';
const MARKER = 'C:\\qaxqjt-frontend\\admin\\p-' + TAG + '-mark.txt';

const FILES = [
    { src: '\\\\tsclient\\D\\shortcut-bubble.js', dst: 'C:\\qaxqjt-frontend\\js\\shortcut-bubble.js', need: ['rippleEffect', 'ripple'] },
    { src: '\\\\tsclient\\D\\index.html', dst: 'C:\\qaxqjt-frontend\\index.html', need: ['shortcut-bubble.js?v=20261016c'] },
    { src: '\\\\tsclient\\D\\self-portal.html', dst: 'C:\\qaxqjt-frontend\\admin\\self-portal.html', need: ['shortcut-bubble.js?v=20261016c'] }
];

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

function probe() {
    log('=== Probe source files ===');
    for (const f of FILES) {
        if (!fs.existsSync(f.src)) { log('FATAL: missing ' + f.src); return false; }
        const content = fs.readFileSync(f.src, 'utf8');
        for (const n of f.need) {
            if (!content.includes(n)) { log('FATAL: missing feature ' + n + ' in ' + f.src); return false; }
        }
        log('OK: ' + f.src);
    }
    return true;
}

function backup() {
    log('=== Backup ===');
    for (const f of FILES) {
        if (fs.existsSync(f.dst)) {
            fs.copyFileSync(f.dst, f.dst + '.bak-' + TAG);
            log('Backed up: ' + f.dst);
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
        const content = fs.readFileSync(f.dst, 'utf8');
        for (const n of f.need) {
            if (!content.includes(n)) { log('FATAL: verify failed ' + n + ' in ' + f.dst); return false; }
        }
        if (content.includes('tsclient')) { log('FATAL: pollution in ' + f.dst); return false; }
        log('OK: ' + f.dst);
    }
    return true;
}

function writeMarker(success, msg) {
    fs.writeFileSync(MARKER, (success ? 'DONE' : 'FAILED') + ' ' + msg + ' ' + new Date().toISOString());
}

(function main() {
    try {
        if (!probe()) { writeMarker(false, 'probe failed'); process.exit(1); }
        backup();
        copyFiles();
        if (!verify()) { writeMarker(false, 'verify failed'); process.exit(1); }
        writeMarker(true, 'ripple deployed');
        log('=== SUCCESS ===');
    } catch (err) {
        writeMarker(false, err.message);
        log('=== FATAL: ' + err.message + ' ===');
        process.exit(1);
    }
})();
