interface ContactButtonProps {
  className?: string;
  href?: string;
  label?: string;
}

export default function ContactButton({
  className = '',
  href = '#contact',
  label = '联系我',
}: ContactButtonProps) {
  return (
    <a href={href} className={'contact-button ' + className}>
      {label}
    </a>
  );
}
