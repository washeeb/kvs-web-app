/**
 * Light / dark / device theme. The choice is kept in this browser only (localStorage); "device" follows the
 * operating system and updates live. THEME_SCRIPT applies it before the first paint so pages never flash.
 */
export const THEME_KEY = "kvs-theme";

export const THEME_SCRIPT = `(function(){var k="${THEME_KEY}",m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=null;try{t=localStorage.getItem(k)}catch(e){}document.documentElement.dataset.theme=t==="dark"||(t!=="light"&&m.matches)?"dark":"light"}a();m.addEventListener("change",a);window.addEventListener("kvs-theme",a);window.addEventListener("storage",function(e){if(e.key===k)a()})})();`;
