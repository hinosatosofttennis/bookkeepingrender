document.getElementById('receiptImage').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    // --- 設定値 ---
    const MAX_WIDTH = 1500; // リサイズ後の最大幅
    const IMAGE_QUALITY = 0.8; // JPEGの画質 (0.0 ~ 1.0)

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // 画像が最大幅より大きい場合のみリサイズ
            if (img.width > MAX_WIDTH) {
                const canvas = document.createElement('canvas');
                const ratio = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * ratio;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Canvasからリサイズされた画像データを取得
                const resizedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
                
                console.log(`リサイズ完了。元のサイズ: ${file.size} byte, 新しいサイズ: ${resizedDataUrl.length} byte`);
                
                // プレビュー表示
                document.getElementById('preview').innerHTML = `<img src="${resizedDataUrl}" style="max-width: 300px;">`;
                
                // ★この resizedDataUrl をサーバーに送信する
                // uploadToServer(resizedDataUrl);

            } else {
                console.log('画像サイズが小さいためリサイズ不要。');
                // プレビュー表示
                document.getElementById('preview').innerHTML = `<img src="${e.target.result}" style="max-width: 300px;">`;

                // ★元のファイルをそのままサーバーに送信する
                // uploadToServer(file);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});
