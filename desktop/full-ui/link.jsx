import { useRouter } from './navigation.jsx';

export default function Link({ href, onClick, target, ...props }) {
  const router = useRouter();
  return (
    <a {...props} href={href} target={target} onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || target || !href.startsWith('/') || href.startsWith('//')) return;
      event.preventDefault();
      router.push(href);
    }} />
  );
}
