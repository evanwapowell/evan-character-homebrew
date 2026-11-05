import sys
from PIL import Image
# crop.py out.png x y w h scale files...
o=sys.argv[1]; x,y,w,h=map(int,sys.argv[2:6]); s=float(sys.argv[6]); files=sys.argv[7:]
ims=[Image.open(f).crop((x,y,x+w,y+h)).resize((int(w*s),int(h*s))) for f in files]
cols=min(4,len(ims)); rows=(len(ims)+cols-1)//cols
out=Image.new('RGB',(int(w*s)*cols,int(h*s)*rows))
for i,im in enumerate(ims): out.paste(im,((i%cols)*int(w*s),(i//cols)*int(h*s)))
out.save(o)
