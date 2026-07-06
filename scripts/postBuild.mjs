import fs from 'fs'

fs.writeFileSync('docs/.nojekyll', '')
console.log('Created docs/.nojekyll')
