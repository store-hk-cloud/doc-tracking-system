export default function Image({ alt, ...props }) {
  delete props.unoptimized;
  // แอปอ่านรูปจากไฟล์ในเครื่องหรือ URL โดยตรง จึงไม่มี Next Image Optimization
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
