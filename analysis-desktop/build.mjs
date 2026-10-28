import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

async function build() {
  console.log('Building SIREN Analysis Visual Editor UI...');
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  const result = await esbuild.build({
    entryPoints: ['src/main.jsx'],
    bundle: true,
    outfile: 'dist/bundle.js',
    minify: true,
    sourcemap: true,
    format: 'iife',
    target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
    loader: {
      '.js': 'jsx',
      '.jsx': 'jsx',
      '.css': 'css'
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });

  // Copy index.html
  fs.copyFileSync('src/index.html', 'dist/index.html');

  // Verify bundle sizes
  const jsStats = fs.statSync('dist/bundle.js');
  let cssSize = 0;
  if (fs.existsSync('dist/bundle.css')) {
    cssSize = fs.statSync('dist/bundle.css').size;
  }

  console.log(`Build complete!`);
  console.log(`  dist/bundle.js: ${(jsStats.size / 1024).toFixed(1)} KB`);
  if (cssSize > 0) {
    console.log(`  dist/bundle.css: ${(cssSize / 1024).toFixed(1)} KB`);
  }
  console.log(`  dist/index.html: ready`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
