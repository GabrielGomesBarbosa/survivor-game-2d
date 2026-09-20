import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function processGeneratorImage() {
  const assetsDir = path.join(rootDir, 'public', 'assets');
  const inputPath = path.join(assetsDir, 'generator.jpeg');
  const outputPath = path.join(assetsDir, 'generator.png');
  const metadataPath = path.join(assetsDir, 'generator.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`Erro: Arquivo não encontrado: ${inputPath}`);
    process.exit(1);
  }

  console.log(`Lendo asset bruto: ${inputPath}`);
  const image = sharp(inputPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  console.log(`Dimensões originais: ${width}x${height} (Canais: ${channels})`);

  // 1. Detectar cor média do fundo cinza nas bordas
  let rSum = 0, gSum = 0, bSum = 0, borderCount = 0;
  const borderMargin = 20;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < borderMargin ||
        x >= width - borderMargin ||
        y < borderMargin ||
        y >= height - borderMargin
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
  console.log(`Cor de fundo detectada: RGB(${bgR.toFixed(1)}, ${bgG.toFixed(1)}, ${bgB.toFixed(1)})`);

  // 2. Flood Fill (BFS) para isolar o fundo e os furos internos dos cabos enrolados
  const visited = new Uint8Array(width * height);
  const queue = [];

  const isBgPixel = (x, y) => {
    const idx = (y * width + x) * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
    return dist < 32;
  };

  // Bordas externas da imagem
  for (let x = 0; x < width; x++) {
    if (!visited[x] && isBgPixel(x, 0)) {
      visited[x] = 1;
      queue.push(x, 0);
    }
    const bIdx = (height - 1) * width + x;
    if (!visited[bIdx] && isBgPixel(x, height - 1)) {
      visited[bIdx] = 1;
      queue.push(x, height - 1);
    }
  }

  for (let y = 0; y < height; y++) {
    const lIdx = y * width;
    if (!visited[lIdx] && isBgPixel(0, y)) {
      visited[lIdx] = 1;
      queue.push(0, y);
    }
    const rIdx = y * width + (width - 1);
    if (!visited[rIdx] && isBgPixel(width - 1, y)) {
      visited[rIdx] = 1;
      queue.push(width - 1, y);
    }
  }

  // Furos dos cabos enrolados à esquerda em cada gerador (detectados por centróide)
  const cableSeeds = [
    [152, 409],  // Frame 0
    [1081, 406], // Frame 1
    [2004, 402]  // Frame 2
  ];
  for (const [cx, cy] of cableSeeds) {
    const cIdx = cy * width + cx;
    if (!visited[cIdx] && isBgPixel(cx, cy)) {
      visited[cIdx] = 1;
      queue.push(cx, cy);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const qx = queue[head++];
    const qy = queue[head++];

    const neighbors = [
      [qx + 1, qy],
      [qx - 1, qy],
      [qx, qy + 1],
      [qx, qy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (!visited[nIdx] && isBgPixel(nx, ny)) {
          visited[nIdx] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  console.log(`Pixels de fundo transparentes mapeados: ${queue.length / 2}`);

  // 3. Converter para buffer RGBA com bordas suavizadas
  const srcRgba = Buffer.alloc(width * height * 4);
  const threshCutoff = 16;
  const threshSoft = 36;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x;
      const sIdx = pIdx * channels;
      const dIdx = pIdx * 4;

      const r = data[sIdx];
      const g = data[sIdx + 1];
      const b = data[sIdx + 2];

      srcRgba[dIdx] = r;
      srcRgba[dIdx + 1] = g;
      srcRgba[dIdx + 2] = b;

      if (visited[pIdx]) {
        const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
        if (dist <= threshCutoff) {
          srcRgba[dIdx + 3] = 0;
        } else if (dist < threshSoft) {
          srcRgba[dIdx + 3] = Math.round(((dist - threshCutoff) / (threshSoft - threshCutoff)) * 255);
        } else {
          srcRgba[dIdx + 3] = 255;
        }
      } else {
        srcRgba[dIdx + 3] = 255;
      }
    }
  }

  // 4. Alinhamento perfeito dos 3 frames:
  // Cada gerador terá exatamente a mesma largura de frame (960px) e altura (1536px),
  // totalizando 2880x1536 (exatamente 2880 / 3 = 960).
  // O centro geométrico do chassi de cada máquina fica no centro exato da célula de cada frame (x = 480).
  const targetCols = 3;
  const targetFrameWidth = 960;
  const targetFrameHeight = height;
  const targetWidth = targetCols * targetFrameWidth; // 2880

  const dstRgba = Buffer.alloc(targetWidth * targetFrameHeight * 4, 0);

  const origCenters = [504, 1418, 2321]; // Centros medidos do chassi de cada gerador

  for (let f = 0; f < 3; f++) {
    const origCenterX = origCenters[f];
    const targetCenterX = f * targetFrameWidth + targetFrameWidth / 2; // f * 960 + 480
    const offsetX = Math.round(targetCenterX - origCenterX);

    // Copiar pixels do gerador correspondente
    // Delimitar zona do frame original
    const srcMinX = Math.max(0, Math.round(origCenterX - 460));
    const srcMaxX = Math.min(width - 1, Math.round(origCenterX + 460));

    for (let y = 0; y < height; y++) {
      for (let x = srcMinX; x <= srcMaxX; x++) {
        const dstX = x + offsetX;
        if (dstX >= f * targetFrameWidth && dstX < (f + 1) * targetFrameWidth) {
          const sIdx = (y * width + x) * 4;
          const dIdx = (y * targetWidth + dstX) * 4;

          dstRgba[dIdx] = srcRgba[sIdx];
          dstRgba[dIdx + 1] = srcRgba[sIdx + 1];
          dstRgba[dIdx + 2] = srcRgba[sIdx + 2];
          dstRgba[dIdx + 3] = srcRgba[sIdx + 3];
        }
      }
    }
  }

  // 5. Gravar spritesheet final otimizado
  await sharp(dstRgba, { raw: { width: targetWidth, height: targetFrameHeight, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`Spritesheet alinhado salvo em: ${outputPath}`);

  const manifest = {
    imageWidth: targetWidth,
    imageHeight: targetFrameHeight,
    cols: targetCols,
    rows: 1,
    frameWidth: targetFrameWidth,
    frameHeight: targetFrameHeight,
    totalFrames: 3,
    frames: {
      inactive: 0,
      repairing: 1,
      completed: 2
    },
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(metadataPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const srcAssetsDir = path.join(rootDir, 'src', 'assets');
  if (!fs.existsSync(srcAssetsDir)) {
    fs.mkdirSync(srcAssetsDir, { recursive: true });
  }
  const srcMetadataPath = path.join(srcAssetsDir, 'generator.json');
  fs.writeFileSync(srcMetadataPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`Manifesto salvo com sucesso em: ${metadataPath}`);
  console.log(`Dimensões finais: ${targetWidth}x${targetFrameHeight} | Frame: ${targetFrameWidth}x${targetFrameHeight}`);
}

processGeneratorImage().catch((err) => {
  console.error('Erro no processamento:', err);
  process.exit(1);
});
