import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import modelUrl from "../model/dangomushi.glb?url";

// ダンゴムシ1匹分の3D状態を管理する内部クラス
class IsopodModel {
  constructor(gltf) {
    const clonedScene = skeletonClone(gltf.scene);

    const box = new THREE.Box3().setFromObject(clonedScene);
    const maxDim = box.getSize(new THREE.Vector3()).length();
    const scale = 80 / maxDim;

    const inner = new THREE.Group();
    inner.rotation.x = Math.PI / 2;
    inner.rotation.y = Math.PI / 2;
    inner.scale.setScalar(scale);
    inner.add(clonedScene);

    this.wrapper = new THREE.Group();
    this.wrapper.add(inner);

    this.mixer = null;
    this.curlAction = null;
    this.uncurlAction = null;
    this.currentState = null;
    this._uncurling = false;
    this._frozenPos = null;
    this._uncurlTimer = 0;

    if (gltf.animations?.length) {
      this.mixer = new THREE.AnimationMixer(clonedScene);

      for (const clip of gltf.animations) {
        const n = clip.name.toLowerCase();
        const a = this.mixer.clipAction(clip);
        if (
          n.includes("uncurl") ||
          n.includes("unroll") ||
          n.includes("open") ||
          n.includes("extend") ||
          n.includes("release") ||
          n.includes("stretch")
        ) {
          this.uncurlAction = a;
        } else if (n.includes("curl") || n.includes("roll")) {
          this.curlAction = a;
        }
      }

      // 名前で判定できなかった場合：順序で割り当て
      if (!this.curlAction && !this.uncurlAction) {
        if (gltf.animations.length >= 2) {
          this.curlAction = this.mixer.clipAction(gltf.animations[0]);
          this.uncurlAction = this.mixer.clipAction(gltf.animations[1]);
        } else if (gltf.animations.length === 1) {
          this.curlAction = this.mixer.clipAction(gltf.animations[0]);
        }
      } else if (this.curlAction && !this.uncurlAction) {
        for (const clip of gltf.animations) {
          const a = this.mixer.clipAction(clip);
          if (a !== this.curlAction) {
            this.uncurlAction = a;
            break;
          }
        }
      }
    }
  }

  _enterCurled() {
    this.currentState = "curled";
    this._uncurling = false;
    this._frozenPos = null;
    this._uncurlTimer = 0;
    this.uncurlAction?.stop();
    if (this.curlAction) {
      const duration = this.curlAction.getClip().duration;
      this.curlAction.timeScale = 1;
      this.curlAction.setLoop(THREE.LoopOnce);
      this.curlAction.clampWhenFinished = true;
      this.curlAction.stop();
      this.curlAction.time = duration;
      this.curlAction.play();
    }
  }

  _exitCurled(isopod) {
    this.currentState = isopod.state;
    this.curlAction?.stop();
    if (this.uncurlAction) {
      const duration = this.uncurlAction.getClip().duration;
      this._frozenPos = { x: isopod.x, y: isopod.y };
      this._uncurling = true;
      this._uncurlTimer = duration;
      this.uncurlAction.timeScale = 1;
      this.uncurlAction.setLoop(THREE.LoopOnce);
      this.uncurlAction.clampWhenFinished = false;
      this.uncurlAction.reset().play();
    }
  }

  update(isopod, dt, w, h) {
    const pos = this._frozenPos ?? isopod;
    this.wrapper.position.set(pos.x - w / 2, -(pos.y - h / 2), 0);

    if (!this._uncurling) {
      this.wrapper.rotation.z = -isopod.angle;
    }

    if (isopod.state === "curled" && this.currentState !== "curled") {
      this._enterCurled();
    } else if (isopod.state !== "curled" && this.currentState === "curled") {
      this._exitCurled(isopod);
    }

    if (this._uncurling) {
      this._uncurlTimer -= dt / 1000;
      if (this._uncurlTimer <= 0) {
        this._uncurling = false;
        this._frozenPos = null;
        this._uncurlTimer = 0;
        this.uncurlAction?.stop();
      }
    }

    if (this.mixer && dt) this.mixer.update(dt / 1000);
  }

  dispose(scene) {
    this.mixer?.stopAllAction();
    scene.remove(this.wrapper);
  }
}

// シーン・レンダラーを1つだけ持ち、全ダンゴムシを管理する
export class IsopodRenderer3D {
  constructor(canvas2d) {
    this.canvas2d = canvas2d;

    this._canvas = document.createElement("canvas");
    this._canvas.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;";
    canvas2d.parentElement.appendChild(this._canvas);

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,
      antialias: true,
    });
    this._scene = new THREE.Scene();

    const w = canvas2d.width,
      h = canvas2d.height;
    this._camera = new THREE.OrthographicCamera(
      -w / 2,
      w / 2,
      h / 2,
      -h / 2,
      0.1,
      1000,
    );
    this._camera.position.z = 100;

    this._scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(1, 2, 3);
    this._scene.add(dir);

    this._models = [];
    this._baseGltf = null;
    this._pendingAdds = 0;

    this.resize(w, h);

    new GLTFLoader().load(modelUrl, (gltf) => {
      console.log(
        "[IsopodRenderer3D] clips:",
        gltf.animations.map((c) => c.name),
      );
      this._baseGltf = gltf;
      const pending = this._pendingAdds;
      this._pendingAdds = 0;
      for (let i = 0; i < pending; i++) this._createModel();
    });
  }

  _createModel() {
    if (!this._baseGltf) {
      this._pendingAdds++;
      return;
    }
    const model = new IsopodModel(this._baseGltf);
    this._scene.add(model.wrapper);
    this._models.push(model);
  }

  addIsopod() {
    this._createModel();
  }

  removeIsopod() {
    const model = this._models.pop();
    model?.dispose(this._scene);
  }

  isUncurlingAt(i) {
    return this._models[i]?._uncurling ?? false;
  }

  update(isopods, dt) {
    const w = this.canvas2d.width,
      h = this.canvas2d.height;
    const len = Math.min(isopods.length, this._models.length);
    for (let i = 0; i < len; i++) {
      this._models[i].update(isopods[i], dt, w, h);
    }
  }

  render() {
    this._renderer.render(this._scene, this._camera);
  }

  resize(w, h) {
    this._canvas.width = w;
    this._canvas.height = h;
    this._renderer.setSize(w, h);
    this._camera.left = -w / 2;
    this._camera.right = w / 2;
    this._camera.top = h / 2;
    this._camera.bottom = -h / 2;
    this._camera.updateProjectionMatrix();
  }
}
