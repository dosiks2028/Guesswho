export async function portraitFromFile(file: File): Promise<string> {
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('INVALID_IMAGE');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 366;
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    canvas.getContext('2d')!.drawImage(image, (canvas.width-image.width*scale)/2, (canvas.height-image.height*scale)/2, image.width*scale, image.height*scale);
    for (const quality of [.82,.65,.45,.25]) { const value = canvas.toDataURL('image/webp', quality); if (value.startsWith('data:image/webp;') && value.length <= 90000) return value; }
    throw new Error('INVALID_IMAGE');
  } finally { image.close(); }
}
