const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src/app/api');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('getServerSession')) {
    // If we previously injected a mock definition inline, remove it
    content = content.replace(/const getServerSession = async[^\n]*\n/g, '');
    
    // Ensure we import it
    if (!content.includes('import { getServerSession')) {
      content = "import { getServerSession, authOptions } from '@/lib/mock-session';\n" + content;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed imports in', file);
  }
});
