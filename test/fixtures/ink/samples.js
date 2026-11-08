/* MindRoot - drawings for the ink suites.
 *
 * EXCALIDRAW is shaped like a file an earlier version saved through
 * Excalidraw 0.17 (exportToSvg with the scene embedded): the svg-source and
 * payload comments, a font-face block, a white background and the shapes.
 * The payload is a stand-in (the editor never decodes it: an old drawing
 * becomes a locked picture behind the new one). It carries non-ASCII text
 * so the UTF-8 to base64 trip is exercised. */
window.INK_SAMPLES = {
  EXCALIDRAW:
    '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="240" height="140">' +
    '<!-- svg-source:excalidraw -->' +
    '<!-- payload-type:application/vnd.excalidraw+json --><!-- payload-version:2 --><!-- payload-start -->' +
    'eyJ2ZXJzaW9uIjoiMSIsImVuY29kaW5nIjoiYnN0cmluZyIsImNvbXByZXNzZWQiOnRydWUsImVuY29kZWQiOiIifQ==' +
    '<!-- payload-end -->' +
    '<defs><style class="style-fonts">@font-face { font-family: "Virgil"; src: url("data:font/woff2;base64,d09GMgABAAAA"); }</style></defs>' +
    '<rect x="0" y="0" width="240" height="140" fill="#ffffff"></rect>' +
    '<g stroke-linecap="round" transform="translate(20 20) rotate(0 100 50)">' +
    '<path d="M0 0 L200 0 L200 100 L0 100 Z" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g>' +
    '<g transform="translate(60 60)"><text x="0" y="18" font-family="Virgil, Segoe UI Emoji" font-size="20px" fill="#1e1e1e">Café déjà vu</text></g>' +
    '</svg>',

  /* A file written by hand with everything a careless or hostile editor
   * could put in the scene: unknown types, bad colours, numbers that are
   * not numbers, a script element, a background that is not an image. */
  HOSTILE:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
    '<metadata id="mindroot-ink">{"v":1,"background":{"x":0,"y":0,"w":10,"h":10},"elements":[' +
    '{"id":"ok","type":"rect","x":1,"y":2,"w":30,"h":-20,"color":"#ABCDEF","width":4,"fill":"weird"},' +
    '{"id":"bad","type":"script","x":1,"y":2},' +
    '{"id":"nan","type":"ellipse","x":"1","y":2,"w":3,"h":4},' +
    '{"id":"ok","type":"line","points":[[0,0],[10,10]],"color":"red"},' +
    '{"id":"x y","type":"text","x":5,"y":5,"text":"&lt;script&gt;alert(1)&lt;/script&gt;","size":-3},' +
    '{"id":"s","type":"stroke","points":[[0,0,9],[5,5,"p"]],"opacity":7}' +
    ']}</metadata>' +
    '<image id="mindroot-ink-bg" x="0" y="0" width="10" height="10" href="javascript:alert(1)"/>' +
    '<script>window.hostileRan = true;</script>' +
    '</svg>'
};
