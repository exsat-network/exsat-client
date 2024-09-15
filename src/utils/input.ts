import { input } from '@inquirer/prompts';

export async function inputWithCancel(
  message: string,
  validatefn?: (value: string) => boolean | string | Promise<string | boolean>
) {
  let value = await input({
    message: message,
    validate: (input) => {
      if (input.trim().toLowerCase() === 'q') {
        return true;
      }
      if (typeof validatefn === 'function') {
        return validatefn(input);
      }
      return true;
    },
  });
  value = value.trim();
  if (value.toLowerCase() === 'q') {
    return false;
  }
  return value;
}
