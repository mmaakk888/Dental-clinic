/** Only the active font is requested; the base Cairo/Amiri pair is in HTML. */
export function activeFontStylesheet(family?:string,customUrl?:string):string|null {
  if(customUrl?.trim())return customUrl.trim();
  const name=(family||'Cairo').split(',')[0].trim().replace(/^['"]|['"]$/g,'');
  if(['cairo','amiri','system-ui','sans-serif'].includes(name.toLowerCase()))return null;
  if(!/^[a-z][a-z0-9 ]{0,79}$/i.test(name))return null;
  return 'https://fonts.googleapis.com/css2?family='+encodeURIComponent(name).replaceAll('%20','+')+':wght@400;600;700&display=swap';
}
