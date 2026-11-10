export default function Image({ alt, ...props }) {
  delete props.unoptimized;
  if (__PWA__ && typeof props.src === 'string' && props.src.startsWith('/icons/')) props.src = __PWA_BASE__ + props.src.slice(1);
  // แอปอ่านรูปจากไฟล์ในเครื่องหรือ URL โดยตรง จึงไม่มี Next Image Optimization
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
