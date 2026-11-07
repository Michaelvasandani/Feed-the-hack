import { Float, RoundedBox, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");

function useTex(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    loader.load(`/api/img?u=${encodeURIComponent(url)}`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (alive) setTex(t);
    }, undefined, () => {});
    return () => { alive = false; };
  }, [url]);
  return tex;
}

const PALETTE = ["#ff4d8d", "#8b5cf6", "#ffb547", "#38bdf8", "#34d399", "#f472b6"];

function ReelCard({ url, index, total, radius }: { url: string | null; index: number; total: number; radius: number }) {
  const tex = useTex(url);
  const angle = (index / total) * Math.PI * 2;
  const y = Math.sin(index * 1.7) * 0.9;
  const ref = useRef<THREE.Group>(null);
  const glow = PALETTE[index % PALETTE.length];
  return (
    <group ref={ref} position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]} rotation={[0, -angle + Math.PI / 2, 0]}>
      <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.35}>
        <RoundedBox args={[1.12, 1.98, 0.04]} radius={0.06} smoothness={4} position={[0, 0, -0.03]}>
          <meshBasicMaterial color={glow} transparent opacity={0.35} />
        </RoundedBox>
        <mesh>
          <planeGeometry args={[1.06, 1.9]} />
          {/* keyed so the shader recompiles with USE_MAP when the texture arrives */}
          {tex ? <meshBasicMaterial key="tex" map={tex} toneMapped={false} side={THREE.DoubleSide} /> : <meshBasicMaterial key="flat" color={glow} transparent opacity={0.25} side={THREE.DoubleSide} />}
        </mesh>
      </Float>
    </group>
  );
}

function Ring({ urls }: { urls: string[] }) {
  const group = useRef<THREE.Group>(null);
  const { pointer } = useThree();
  const count = Math.max(14, urls.length);
  const radius = count * 0.36;
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.rotation.y += dt * 0.07;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, 0.12 + pointer.y * 0.12, 0.04);
    group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, pointer.x * 0.6, 0.04);
  });
  const items = useMemo(() => Array.from({ length: count }, (_, i) => urls[i % Math.max(1, urls.length)] ?? null), [urls, count]);
  return (
    <group ref={group}>
      {items.map((u, i) => <ReelCard key={i} url={u} index={i} total={count} radius={radius} />)}
    </group>
  );
}

export default function Scene3D({ urls }: { urls: string[] }) {
  const radius = Math.max(14, urls.length) * 0.36;
  return (
    <Canvas camera={{ position: [0, 0.6, radius + 4.2], fov: 45 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
      <fog attach="fog" args={["#07070b", radius + 1, radius * 2 + 6]} />
      <Suspense fallback={null}>
        <Ring urls={urls} />
        <Sparkles count={120} scale={[radius * 2.4, 6, radius * 2.4]} size={2.2} speed={0.35} color="#ffb6d5" opacity={0.6} />
      </Suspense>
    </Canvas>
  );
}
