import { buttonClasses } from '../../utils/buttonClasses';

/** Button using the shared variants in src/utils/buttonClasses.js. */
export default function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}
