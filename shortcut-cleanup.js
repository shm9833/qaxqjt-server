const fs = require('fs');
const marker = 'C:\\qaxqjt-frontend\\admin\\p-shortcut1016-mark.txt';
const clean = 'C:\\qaxqjt-frontend\\admin\\p-shortcut1016-clean.txt';

if (fs.existsSync(marker)) {
    fs.unlinkSync(marker);
    fs.writeFileSync(clean, 'DONE cleanup ' + new Date().toISOString());
} else {
    fs.writeFileSync(clean, 'MARKER_NOT_FOUND');
}
