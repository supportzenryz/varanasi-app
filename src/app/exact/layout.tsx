/** The exact preview brings its own stylesheet, so the rebuilt design system
 *  and its Tailwind reset must stay out of the way. */
export default function ExactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
