import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useRef } from 'react';

interface AnimatedTextProps {
  text: string;
  className?: string;
}

function Char({
  children,
  progress,
  range,
}: {
  children: string;
  progress: MotionValue<number>;
  range: [number, number];
}) {
  const opacity = useTransform(progress, range, [0.2, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block whitespace-pre">
      {children}
    </motion.span>
  );
}

export default function AnimatedText({ text, className = '' }: AnimatedTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.2'] as any,
  });

  const chars = text.split('');

  return (
    <p ref={ref} className={'inline-block ' + className}>
      {chars.map((char, i) => (
        <Char key={i} progress={scrollYProgress} range={[i / chars.length, (i + 1) / chars.length]}>
          {char}
        </Char>
      ))}
    </p>
  );
}
