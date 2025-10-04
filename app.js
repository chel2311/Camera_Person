// アプリケーションのメインクラス
class PersonDetectionApp {
    constructor() {
        // 定数の定義
        this.MAX_GALLERY_ITEMS = 20;
        this.SKELETON_COLOR = '#00ff00';
        this.KEYPOINT_COLOR = '#ff0000';
        this.POSE_CONNECTIONS = [
            [11, 12], // shoulders
            [11, 13], [13, 15], // left arm
            [12, 14], [14, 16], // right arm
            [11, 23], [12, 24], // torso
            [23, 24], // hips
            [23, 25], [25, 27], // left leg
            [24, 26], [26, 28]  // right leg
        ];

        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlayCanvas = document.getElementById('detection-overlay');
        this.overlayCtx = this.overlayCanvas.getContext('2d');

        this.stream = null;
        this.isDetecting = false;
        this.captureCount = 0;
        this.lastCaptureTime = 0;
        this.pose = null;

        this.initializeElements();
        this.initializeMediaPipe();
        this.bindEvents();
        this.setupKeyboardShortcuts();
    }

    initializeElements() {
        this.startBtn = document.getElementById('start-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.toggleDetectionBtn = document.getElementById('toggle-detection');
        this.detectionStatus = document.getElementById('detection-status');
        this.captureCountEl = document.getElementById('capture-count');
        this.autoCapture = document.getElementById('auto-capture');
        this.captureInterval = document.getElementById('capture-interval');
        this.confidenceThreshold = document.getElementById('confidence-threshold');
        this.thresholdValue = document.getElementById('threshold-value');
        this.gallery = document.getElementById('image-gallery');
        this.notification = document.getElementById('notification');

        // 一括操作ボタン
        this.selectAllBtn = document.getElementById('select-all-btn');
        this.deselectAllBtn = document.getElementById('deselect-all-btn');
        this.downloadAllBtn = document.getElementById('download-all-btn');
        this.deleteSelectedBtn = document.getElementById('delete-selected-btn');
        this.clearAllBtn = document.getElementById('clear-all-btn');

        // 選択状態管理
        this.selectedImages = new Set();
    }

    initializeMediaPipe() {
        // MediaPipe Poseの初期化
        this.pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
            }
        });

        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults((results) => this.onPoseResults(results));
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.stopBtn.addEventListener('click', () => this.stopCamera());
        this.toggleDetectionBtn.addEventListener('click', () => this.toggleDetection());
        this.confidenceThreshold.addEventListener('input', (e) => {
            this.thresholdValue.textContent = e.target.value;
        });

        // 一括操作ボタンのイベントリスナー
        this.selectAllBtn.addEventListener('click', () => this.selectAllImages());
        this.deselectAllBtn.addEventListener('click', () => this.deselectAllImages());
        this.downloadAllBtn.addEventListener('click', () => this.downloadAllImages());
        this.deleteSelectedBtn.addEventListener('click', () => this.deleteSelectedImages());
        this.clearAllBtn.addEventListener('click', () => this.clearAllImages());
    }

    async startCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                }
            });

            this.video.srcObject = this.stream;

            this.video.addEventListener('loadedmetadata', () => {
                this.canvas.width = this.video.videoWidth;
                this.canvas.height = this.video.videoHeight;
                this.overlayCanvas.width = this.video.videoWidth;
                this.overlayCanvas.height = this.video.videoHeight;
            });

            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.toggleDetectionBtn.disabled = false;

            this.showNotification('カメラが開始されました');
        } catch (error) {
            console.error('カメラの起動に失敗しました:', error);
            let message = 'カメラの起動に失敗しました。';

            if (error.name === 'NotAllowedError') {
                message = 'カメラへのアクセスが拒否されました。ブラウザの設定を確認し、カメラのアクセスを許可してください。';
            } else if (error.name === 'NotFoundError') {
                message = '利用可能なカメラが見つかりませんでした。';
            } else if (error.name === 'NotReadableError') {
                message = 'カメラが他のアプリケーションで使用中の可能性があります。';
            } else if (error.name === 'OverconstrainedError') {
                message = '要求されたカメラ設定がサポートされていません。';
            }

            this.showNotification(message, 'error');
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
            this.video.srcObject = null;
        }

        this.isDetecting = false;
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.toggleDetectionBtn.disabled = true;
        this.toggleDetectionBtn.textContent = '検出開始';
        this.detectionStatus.textContent = '停止';
        this.detectionStatus.classList.remove('active');

        this.clearOverlay();
        this.showNotification('カメラが停止されました');
    }

    toggleDetection() {
        if (this.isDetecting) {
            this.stopDetection();
        } else {
            this.startDetection();
        }
    }

    async startDetection() {
        this.isDetecting = true;
        this.toggleDetectionBtn.textContent = '検出停止';
        this.detectionStatus.textContent = '検出中';
        this.detectionStatus.classList.add('active');

        this.showNotification('人物検出を開始しました');
        this.detectionLoop();
    }

    detectionLoop() {
        if (!this.isDetecting || !this.stream) {
            this.clearOverlay();
            return;
        }

        this.pose.send({ image: this.video }).then(() => {
            requestAnimationFrame(() => this.detectionLoop());
        }).catch((error) => {
            console.error('検出処理でエラーが発生しました:', error);
            this.stopDetection();
        });
    }

    stopDetection() {
        this.isDetecting = false;
        this.toggleDetectionBtn.textContent = '検出開始';
        this.detectionStatus.textContent = '待機中';
        this.detectionStatus.classList.remove('active');

        this.clearOverlay();
        this.showNotification('人物検出を停止しました');
    }

    onPoseResults(results) {
        try {
            this.clearOverlay();

            if (results.poseLandmarks) {
                // 人物を検出
                this.drawPoseOverlay(results);

                const confidence = this.calculateConfidence(results.poseLandmarks);

                if (confidence >= parseFloat(this.confidenceThreshold.value)) {
                    this.onPersonDetected(confidence);
                }
            }
        } catch (error) {
            console.error('onPoseResultsでエラーが発生しました:', error);
            // エラーが頻発する場合は検出を停止
            if (this.poseErrorCount === undefined) {
                this.poseErrorCount = 0;
            }
            this.poseErrorCount++;

            if (this.poseErrorCount > 10) {
                console.error('エラーが頻発したため、検出を停止します');
                this.stopDetection();
                this.showNotification('検出エラーが発生しました。検出を停止しました。', 'error');
            }
        }
    }

    calculateConfidence(landmarks) {
        // 主要なランドマークの可視性から信頼度を計算
        const keyPoints = [
            landmarks[0],  // nose
            landmarks[11], // left shoulder
            landmarks[12], // right shoulder
            landmarks[23], // left hip
            landmarks[24]  // right hip
        ];

        // 可視性のチェックを緩和: 0.6 -> 0.5、必要数 4 -> 3
        const visibleKeypoints = keyPoints.filter(point =>
            point && point.visibility && point.visibility > 0.5
        );

        console.log(`[DEBUG] 可視キーポイント数: ${visibleKeypoints.length}/5`);

        if (visibleKeypoints.length < 3) {
            console.log('[DEBUG] キーポイント不足でキャプチャ拒否');
            return 0; // 主要ポイントが不足している場合は無効
        }

        // 人体構造の妥当性をチェック - 顔のみ検出時は緩和
        const structureValid = this.validatePoseStructure(landmarks);
        console.log(`[DEBUG] 構造妥当性: ${structureValid}`);

        // 顔のみ検出の可能性を判定（胴体が小さい場合）
        const torsoLength = Math.abs((landmarks[11].y + landmarks[12].y) / 2 - (landmarks[23].y + landmarks[24].y) / 2);
        const isFaceOnlyDetection = torsoLength < 0.08; // 8%未満は顔のみ検出の可能性

        console.log(`[DEBUG] 胴体長: ${torsoLength.toFixed(3)}, 顔のみ検出判定: ${isFaceOnlyDetection}`);

        if (!structureValid && !isFaceOnlyDetection) {
            console.log('[DEBUG] 構造妥当性チェック失敗でキャプチャ拒否');
            return 0; // 人体として不自然な形状の場合は無効
        } else if (!structureValid && isFaceOnlyDetection) {
            console.log('[DEBUG] 顔のみ検出のため構造チェックを緩和');
            // 顔のみ検出の場合は構造チェックを通す
        }

        // 可視性の平均を計算
        const avgVisibility = keyPoints.reduce((sum, point) => {
            return sum + (point && point.visibility ? point.visibility : 0);
        }, 0) / keyPoints.length;

        console.log(`[DEBUG] 最終信頼度: ${avgVisibility.toFixed(3)}`);
        return avgVisibility;
    }

    validatePoseStructure(landmarks) {
        try {
            const nose = landmarks[0];
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];
            const leftHip = landmarks[23];
            const rightHip = landmarks[24];

            // 必要なポイントが存在しているかチェック
            if (!nose || !leftShoulder || !rightShoulder || !leftHip || !rightHip) {
                return false;
            }

            // 肩の幅をチェック（現実的な範囲内かどうか）- 条件を緩和
            const shoulderDistance = Math.abs(leftShoulder.x - rightShoulder.x);
            if (shoulderDistance < 0.03 || shoulderDistance > 0.6) { // 画面幅の3%〜60%に緩和
                console.log(`[DEBUG] 肩幅チェック失敗: ${shoulderDistance.toFixed(3)}`);
                return false;
            }

            // 腰の幅をチェック - 条件を緩和
            const hipDistance = Math.abs(leftHip.x - rightHip.x);
            if (hipDistance < 0.02 || hipDistance > 0.5) { // 画面幅の2%〜50%に緩和
                console.log(`[DEBUG] 腰幅チェック失敗: ${hipDistance.toFixed(3)}`);
                return false;
            }

            // 胴体の長さをチェック（肩から腰まで）- 顔のみ・部分検出に対応
            const torsoLength = Math.abs((leftShoulder.y + rightShoulder.y) / 2 - (leftHip.y + rightHip.y) / 2);
            if (torsoLength < 0.02 || torsoLength > 0.8) { // 画面高の2%〜80%に大幅緩和（顔のみでも対応）
                console.log(`[DEBUG] 胴体長チェック失敗: ${torsoLength.toFixed(3)}`);
                return false;
            }

            // 頭の位置チェック（肩より上にあるか）- 大幅緩和
            const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
            if (nose.y > shoulderY + 0.15) { // 15%の大きなマージンを追加（顔のみでも対応）
                console.log(`[DEBUG] 頭部位置チェック失敗: nose=${nose.y.toFixed(3)}, shoulder=${shoulderY.toFixed(3)}`);
                return false;
            }

            // 対称性チェック（左右の肩と腰の高さがある程度揃っているか）- さらに緩和
            const shoulderSymmetry = Math.abs(leftShoulder.y - rightShoulder.y);
            const hipSymmetry = Math.abs(leftHip.y - rightHip.y);
            if (shoulderSymmetry > 0.25 || hipSymmetry > 0.25) { // 25%以上のずれは不自然に大幅緩和
                console.log(`[DEBUG] 対称性チェック失敗: 肩=${shoulderSymmetry.toFixed(3)}, 腰=${hipSymmetry.toFixed(3)}`);
                return false;
            }

            return true;
        } catch (error) {
            console.warn('ポーズ構造の検証中にエラーが発生しました:', error);
            return false;
        }
    }

    drawPoseOverlay(results) {
        const landmarks = results.poseLandmarks;

        this.overlayCtx.save();
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // 骨格線を描画
        this.overlayCtx.strokeStyle = this.SKELETON_COLOR;
        this.overlayCtx.lineWidth = 2;

        this.POSE_CONNECTIONS.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];

            if (startPoint && endPoint) {
                this.overlayCtx.beginPath();
                this.overlayCtx.moveTo(
                    startPoint.x * this.overlayCanvas.width,
                    startPoint.y * this.overlayCanvas.height
                );
                this.overlayCtx.lineTo(
                    endPoint.x * this.overlayCanvas.width,
                    endPoint.y * this.overlayCanvas.height
                );
                this.overlayCtx.stroke();
            }
        });

        // キーポイントを描画
        this.overlayCtx.fillStyle = this.KEYPOINT_COLOR;
        landmarks.forEach(landmark => {
            if (landmark.visibility > 0.5) {
                this.overlayCtx.beginPath();
                this.overlayCtx.arc(
                    landmark.x * this.overlayCanvas.width,
                    landmark.y * this.overlayCanvas.height,
                    5, 0, 2 * Math.PI
                );
                this.overlayCtx.fill();
            }
        });

        this.overlayCtx.restore();
    }

    onPersonDetected(confidence) {
        const now = Date.now();
        const intervalMs = parseInt(this.captureInterval.value) * 1000;

        if (this.autoCapture.checked && (now - this.lastCaptureTime) > intervalMs) {
            this.captureImage(confidence);
            this.lastCaptureTime = now;
        }
    }

    captureImage(confidence) {
        // キャンバスに現在のビデオフレームを描画
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        // 画像データを取得
        this.canvas.toBlob((blob) => {
            const timestamp = new Date().toLocaleString('ja-JP');
            const filename = `person_${Date.now()}.jpg`;

            // 画像をギャラリーに追加
            this.addToGallery(blob, timestamp, filename, confidence);

            // キャプチャカウントを更新
            this.captureCount++;
            this.captureCountEl.textContent = `キャプチャ: ${this.captureCount}`;

            this.showNotification(`人物を検出しました (信頼度: ${(confidence * 100).toFixed(1)}%)`);
        }, 'image/jpeg', 0.9);
    }

    addToGallery(blob, timestamp, filename, confidence) {
        const url = URL.createObjectURL(blob);
        const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const galleryItem = document.createElement('div');
        galleryItem.className = 'gallery-item';
        galleryItem.dataset.itemId = itemId;
        galleryItem.dataset.url = url;
        galleryItem.dataset.filename = filename;

        galleryItem.innerHTML = `
            <div class="selection-checkbox"></div>
            <img src="${url}" alt="Captured person">
            <div class="timestamp">${timestamp}</div>
            <div class="item-controls">
                <button class="item-btn download-btn" title="ダウンロード">
                    <i class="fas fa-download"></i>
                </button>
                <button class="item-btn delete-btn" title="削除">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        // クリックで選択/選択解除
        galleryItem.addEventListener('click', (e) => {
            if (!e.target.closest('.item-controls')) {
                this.toggleImageSelection(itemId, galleryItem);
            }
        });

        // ダウンロードボタン
        const downloadBtn = galleryItem.querySelector('.download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadImage(url, filename);
        });

        // 削除ボタン
        const deleteBtn = galleryItem.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteImage(itemId, galleryItem);
        });

        this.gallery.insertBefore(galleryItem, this.gallery.firstChild);

        // 最大表示数を超えた場合、古い画像を削除
        while (this.gallery.children.length > this.MAX_GALLERY_ITEMS) {
            const lastChild = this.gallery.lastChild;
            const itemId = lastChild.dataset.itemId;
            this.selectedImages.delete(itemId);
            const img = lastChild.querySelector('img');
            if (img && img.src) {
                URL.revokeObjectURL(img.src);
            }
            this.gallery.removeChild(lastChild);
        }

        this.updateGalleryControls();
    }

    downloadImage(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        this.showNotification('画像を保存しました');
    }

    clearOverlay() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }

    showNotification(message, type = 'success') {
        this.notification.textContent = message;
        this.notification.style.background = type === 'error' ?
            'var(--danger-color)' : 'var(--success-color)';

        this.notification.classList.add('show');

        setTimeout(() => {
            this.notification.classList.remove('show');
        }, 3000);
    }

    setupKeyboardShortcuts() {
        let keysPressed = [];

        document.addEventListener('keydown', (e) => {
            keysPressed.push(e.key.toLowerCase());
            keysPressed = keysPressed.slice(-4); // 最後の4文字を保持

            // docsと入力: ドキュメントを開く
            if (keysPressed.join('') === 'docs') {
                e.preventDefault();
                this.openDocumentation();
                keysPressed = [];
            }

            // Cキー: カメラの開始/停止
            if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (this.stream) {
                    this.stopCamera();
                } else {
                    this.startCamera();
                }
            }

            // スペースキー: 検出の開始/停止
            if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (this.stream && !this.toggleDetectionBtn.disabled) {
                    this.toggleDetection();
                }
            }

            // Sキー: 手動キャプチャ
            if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (this.stream && this.isDetecting) {
                    this.captureImage(1.0); // 手動キャプチャは信頼度100%として扱う
                    this.showNotification('手動キャプチャを実行しました');
                }
            }

            // ?キー: ヘルプ表示
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                this.showHelp();
            }
        });
    }

    openDocumentation() {
        // 新しいウィンドウでドキュメントを開く
        const docsWindow = window.open('docs.html', 'docs', 'width=1200,height=800');
        if (!docsWindow) {
            this.showNotification('ドキュメントを開けませんでした。ポップアップブロックを確認してください。', 'error');
        }
    }

    showHelp() {
        const helpMessage = `
キーボードショートカット:
[docs] - ドキュメントを開く（d,o,c,sと順に入力）
[C] - カメラ開始/停止
[Space] - 検出開始/停止
[S] - 手動キャプチャ
[?] - このヘルプを表示

信頼度調整のヒント:
検出されない場合は信頼度を0.3〜0.5に調整してください`;

        alert(helpMessage);
    }

    // 画像選択/選択解除
    toggleImageSelection(itemId, element) {
        if (this.selectedImages.has(itemId)) {
            this.selectedImages.delete(itemId);
            element.classList.remove('selected');
        } else {
            this.selectedImages.add(itemId);
            element.classList.add('selected');
        }
        this.updateGalleryControls();
    }

    // 全選択
    selectAllImages() {
        const items = this.gallery.querySelectorAll('.gallery-item');
        items.forEach(item => {
            const itemId = item.dataset.itemId;
            this.selectedImages.add(itemId);
            item.classList.add('selected');
        });
        this.updateGalleryControls();
    }

    // 選択解除
    deselectAllImages() {
        this.selectedImages.clear();
        this.gallery.querySelectorAll('.gallery-item').forEach(item => {
            item.classList.remove('selected');
        });
        this.updateGalleryControls();
    }

    // 一括ダウンロード
    downloadAllImages() {
        const items = this.gallery.querySelectorAll('.gallery-item');
        if (items.length === 0) {
            this.showNotification('ダウンロードする画像がありません', 'error');
            return;
        }

        // ZIPライブラリがないため、個別ダウンロード
        items.forEach((item, index) => {
            setTimeout(() => {
                this.downloadImage(item.dataset.url, item.dataset.filename);
            }, index * 500); // 0.5秒間隔でダウンロード
        });

        this.showNotification(`${items.length}枚の画像を一括ダウンロード中...`);
    }

    // 選択した画像を削除
    deleteSelectedImages() {
        if (this.selectedImages.size === 0) {
            this.showNotification('削除する画像が選択されていません', 'error');
            return;
        }

        if (confirm(`選択した${this.selectedImages.size}枚の画像を削除しますか？`)) {
            this.selectedImages.forEach(itemId => {
                const item = this.gallery.querySelector(`[data-item-id="${itemId}"]`);
                if (item) {
                    this.deleteImage(itemId, item);
                }
            });
            this.selectedImages.clear();
            this.updateGalleryControls();
        }
    }

    // 全画像を削除
    clearAllImages() {
        const items = this.gallery.querySelectorAll('.gallery-item');
        if (items.length === 0) {
            this.showNotification('削除する画像がありません', 'error');
            return;
        }

        if (confirm(`すべての画像（${items.length}枚）を削除しますか？`)) {
            items.forEach(item => {
                const itemId = item.dataset.itemId;
                this.deleteImage(itemId, item);
            });
            this.selectedImages.clear();
            this.updateGalleryControls();
        }
    }

    // 個別画像削除
    deleteImage(itemId, element) {
        const url = element.dataset.url;
        if (url) {
            URL.revokeObjectURL(url);
        }
        this.selectedImages.delete(itemId);
        element.remove();
        this.updateGalleryControls();
        this.showNotification('画像を削除しました');
    }

    // ギャラリーコントロールの更新
    updateGalleryControls() {
        const totalItems = this.gallery.children.length;
        const selectedCount = this.selectedImages.size;

        // 選択状態によるボタン表示制御
        if (selectedCount > 0) {
            this.selectAllBtn.style.display = 'none';
            this.deselectAllBtn.style.display = 'inline-block';
            this.deleteSelectedBtn.style.display = 'inline-block';
            this.deleteSelectedBtn.innerHTML = `<i class="fas fa-trash"></i> 選択削除 (${selectedCount})`;
        } else {
            this.selectAllBtn.style.display = 'inline-block';
            this.deselectAllBtn.style.display = 'none';
            this.deleteSelectedBtn.style.display = 'none';
        }

        // 全選択ボタンの状態更新
        if (totalItems > 0 && selectedCount === totalItems) {
            this.selectAllBtn.style.display = 'none';
            this.deselectAllBtn.style.display = 'inline-block';
        }
    }
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PersonDetectionApp();
});