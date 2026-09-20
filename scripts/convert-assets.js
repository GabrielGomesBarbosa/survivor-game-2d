import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function processSurvivorImage() {
  const assetsDir = path.join(rootDir, 'public', 'assets');
  
  // Selecionar o arquivo de entrada mais recente entre .jpg e .jpeg (ou argumento CLI)
  const candidateFiles = ['survivor.jpeg', 'survivor.jpg'];
  let chosenFile = null;
  let newestMtime = -1;

  if (process.argv[2]) {
    const customPath = path.resolve(process.argv[2]);
    if (fs.existsSync(customPath)) {
      chosenFile = customPath;
    }
  }

  if (!chosenFile) {
    for (const file of candidateFiles) {
      const fullPath = path.join(assetsDir, file);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs > newestMtime) {
          newestMtime = stats.mtimeMs;
          chosenFile = fullPath;
        }
      }
    }
  }

  if (!chosenFile) {
    console.error('Erro: Nenhum asset encontrado em public/assets/ (survivor.jpeg ou survivor.jpg)');
    process.exit(1);
  }

  const outputPath = path.join(assetsDir, 'survivor.png');
  const metadataPath = path.join(assetsDir, 'survivor.json');

  console.log(`Lendo asset de entrada: ${chosenFile}`);

  const image = sharp(chosenFile);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  console.log(`Dimensões da imagem: ${width}x${height} (Canais: ${channels})`);

  // Detectar a grelha padrão (4 colunas x 2 linhas: 4 walk, 4 run)
  const cols = 4;
  const rows = 2;
  const frameWidth = Math.floor(width / cols);
  const frameHeight = Math.floor(height / rows);

  console.log(`Grelha de spritesheets: ${cols}x${rows} -> Frames de ${frameWidth}x${frameHeight}px`);

  // 1. Detectar cor predominante de fundo nas bordas externas
  let rSum = 0, gSum = 0, bSum = 0, borderCount = 0;
  const borderThickness = 15;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < borderThickness ||
        x >= width - borderThickness ||
        y < borderThickness ||
        y >= height - borderThickness
      ) {
        const idx = (y * width + x) * channels;
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        borderCount++;
      }
    }
  }

  const bgR = rSum / borderCount;
  const bgG = gSum / borderCount;
  const bgB = bSum / borderCount;

  console.log(`Cor de fundo predominante detectada: RGB(${bgR.toFixed(1)}, ${bgG.toFixed(1)}, ${bgB.toFixed(1)})`);

  // 2. Tornar fundo 100% transparente com transição suave nas bordas para evitar halos
  const rgba = Buffer.alloc(width * height * 4);
  const threshCutoff = 18;
  const threshSoft = 36;

  let transparentCount = 0;
  let semiCount = 0;
  let opaqueCount = 0;

  for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);

    let a = 255;
    if (dist <= threshCutoff) {
      a = 0;
      transparentCount++;
    } else if (dist < threshSoft) {
      a = Math.round(((dist - threshCutoff) / (threshSoft - threshCutoff)) * 255);
      semiCount++;
    } else {
      opaqueCount++;
    }

    rgba[j] = r;
    rgba[j + 1] = g;
    rgba[j + 2] = b;
    rgba[j + 3] = a;
  }

  console.log(
    `Processamento concluído: ${transparentCount} transparentes (${(
      (transparentCount / (width * height)) *
      100
    ).toFixed(1)}%), ${semiCount} suavizados, ${opaqueCount} opacos`
  );

  // 3. Salvar como PNG otimizado
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  const manifest = {
    imageWidth: width,
    imageHeight: height,
    cols,
    rows,
    frameWidth,
    frameHeight,
    totalFrames: cols * rows,
    walkFrames: [0, 1, 2, 3],
    runFrames: [4, 5, 6, 7],
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(metadataPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const srcAssetsDir = path.join(rootDir, 'src', 'assets');
  if (!fs.existsSync(srcAssetsDir)) {
    fs.mkdirSync(srcAssetsDir, { recursive: true });
  }
  const srcMetadataPath = path.join(srcAssetsDir, 'survivor.json');
  fs.writeFileSync(srcMetadataPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`PNG salvo em: ${outputPath}`);
  console.log(`Manifesto salvo em: ${metadataPath} e ${srcMetadataPath}`);
}

processSurvivorImage().catch((err) => {
  console.error('Erro ao converter asset:', err);
  process.exit(1);
});
