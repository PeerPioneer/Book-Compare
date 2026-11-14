/* checks the fast rectangle morphology against OpenCV's own result on random blobs: must be identical */
(async()=>{
let cv=require('@techstark/opencv-js'); if(cv instanceof Promise) cv=await cv; else if(typeof cv.then==='function') cv=await new Promise(r=>cv.then(x=>{delete x.then;r(x)}));
const R=require('./rectmorph');
const w=700,h=500;let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
const src=new Uint8Array(w*h);
for(let k=0;k<60;k++){const x=Math.floor(rnd()*w),y=Math.floor(rnd()*h),bw=Math.floor(rnd()*300)+1,bh=Math.floor(rnd()*200)+1;for(let j=y;j<Math.min(h,y+bh);j++)for(let i=x;i<Math.min(w,x+bw);i++)src[j*w+i]=1;}
for(let i=0;i<w;i++)src[i]=1; // a run touching the border
const m=new cv.Mat(h,w,cv.CV_8U);m.data.set(src);
let bad=0;
for(const [name,op,cvop,kh,kw] of [['open',R.openRect,cv.MORPH_OPEN,1,250],['open',R.openRect,cv.MORPH_OPEN,250,1],['open',R.openRect,cv.MORPH_OPEN,200,15],['open',R.openRect,cv.MORPH_OPEN,15,200],['open',R.openRect,cv.MORPH_OPEN,101,101],['close',R.closeRect,cv.MORPH_CLOSE,61,61],['close',R.closeRect,cv.MORPH_CLOSE,60,40],['dilate',R.dilateRect,null,21,21],['dilate',R.dilateRect,null,7,1],['dilate',R.dilateRect,null,1,7]]){
  const o=new cv.Mat();const K=cv.Mat.ones(kh,kw,cv.CV_8U);
  if(cvop===null)cv.dilate(m,o,K);else cv.morphologyEx(m,o,cvop,K);
  const mine=op(src,w,h,kh,kw);let d=0;const od=o.data;for(let i=0;i<od.length;i++)if(od[i]!==mine[i])d++;
  console.log(name,kh+'x'+kw,'differing pixels:',d);bad+=d;
}
console.log(bad===0?'IDENTICAL':'DIFFERENT');
})();
