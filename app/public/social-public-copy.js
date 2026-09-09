// Shared by the administrative preview and server. Public copy cannot contain
// links, including shorteners and bare domains; ordinary decimal values remain.
const links=()=>/(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|javascript|data):|\bwww\.)[^\s<>]+|(?<![\p{L}\p{N}_-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59})(?![\p{L}\p{N}_-])(?::\d{1,5})?(?:[/?#][^\s<>]*)?/giu;
const text=value=>typeof value==='string'?value.normalize('NFKC'):'';
export const publicCopyHasLinks=value=>links().test(text(value));
export const removePublicLinks=value=>text(value).replace(links(),'').replace(/[ \t]{2,}/g,' ').trim();
