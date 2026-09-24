(function(root) {
'use strict';
function compress(file) {
  return new Promise(function(resolve,reject) {
    if (!file || !/^image\//.test(file.type || '') || file.size > 25 * 1024 * 1024) return reject(new Error('image'));
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error('read')); };
    reader.onload = function(event) {
      var img = new Image();
      img.onerror = function() { reject(new Error('decode')); };
      img.onload = function() {
        try {
          if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 120000000) throw new Error('size');
          var scale = Math.min(1,1600 / Math.max(img.naturalWidth,img.naturalHeight));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1,Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1,Math.round(img.naturalHeight * scale));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          for (var quality = 0.8; quality >= 0.4; quality -= 0.1) {
            var url = canvas.toDataURL('image/jpeg',quality);
            var data = url.slice('data:image/jpeg;base64,'.length);
            if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(url) && data.length % 4 === 0 && data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) <= 2 * 1024 * 1024) {
              resolve({mime:'image/jpeg',data:data}); return;
            }
          }
          throw new Error('large');
        } catch (_) { reject(new Error('image')); }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function select(state, input, ui, compressor) {
  var file = input.files && input.files[0];
  if (!file || (ui.locked && ui.locked())) return;
  var selection = ++state.selection;
  state.busy = true; ui.ready(false);
  ui.status('写真を準備しています…');
  try {
    var photo = await (compressor || compress)(file);
    if (selection !== state.selection) return;
    state.photo = photo;
    ui.preview.src = 'data:' + photo.mime + ';base64,' + photo.data;
    ui.preview.style.display = 'block';
    ui.retake.style.display = '';
    ui.status('文字と署名が読めることをご確認ください。');
  } catch (_) {
    if (selection !== state.selection) return;
    ui.status(state.photo ? 'この写真は読み込めませんでした。前の写真は残っています。写真を選び直してください。' : 'この写真は読み込めませんでした。JPEGなど別の写真を選ぶか、撮り直してください。');
  } finally {
    if (selection === state.selection) {
      state.busy = false; ui.ready(!!state.photo); input.value = '';
    }
  }
}
root.ECOPITA_CONSENT_PHOTO = { compress:compress, select:select };
})(window);
