// CSS Modules and global styles
declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}