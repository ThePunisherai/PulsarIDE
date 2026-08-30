export const CRT_VERTEX_SHADER = "attribute vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos,0.0,1.0); }";

export const CRT_FRAGMENT_SHADER =
  "precision highp float;\n"+
  "uniform sampler2D uTex;\n"+
  "uniform vec2 uRes;\n"+
  "uniform float uTime;\n"+
  "uniform float uMotion;\n"+
  "float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }\n"+
  "vec2 curve(vec2 uv){\n"+
  "  uv = uv*2.0-1.0;\n"+
  "  vec2 o = uv.yx*uv.yx;\n"+
  "  uv += uv * o * vec2(0.115,0.165);\n"+
  "  uv = uv*0.5+0.5;\n"+
  "  return uv;\n"+
  "}\n"+
  "void main(){\n"+
  "  vec2 fuv = gl_FragCoord.xy / uRes;\n"+
  "  vec2 uv = curve(fuv);\n"+
  "  vec2 inb = step(vec2(0.0), uv) * step(uv, vec2(1.0));\n"+
  "  float inside = inb.x*inb.y;\n"+
  "  vec2 ed = min(uv, 1.0-uv);\n"+
  "  inside *= smoothstep(0.0,0.020, min(ed.x,ed.y));\n"+
  "  vec2 dir = uv-0.5;\n"+
  "  float d2 = dot(dir,dir);\n"+
  "  vec2 ao = dir * (0.0016 + 0.012*d2);\n"+
  "  vec3 col;\n"+
  "  col.r = texture2D(uTex, uv + ao).r;\n"+
  "  col.g = texture2D(uTex, uv).g;\n"+
  "  col.b = texture2D(uTex, uv - ao).b;\n"+
  "  float lines = uRes.y*0.92;\n"+
  "  float sl = sin(uv.y*3.14159265*lines + uTime*4.0*uMotion);\n"+
  "  col *= mix(0.70,1.0, sl*sl);\n"+
  "  float gx = gl_FragCoord.x * (6.2831853/3.0);\n"+
  "  vec3 grille = 0.66 + 0.34*cos(gx + vec3(0.0,2.094,4.188));\n"+
  "  col *= grille;\n"+
  "  col *= 1.34;\n"+
  "  float bar = fract(uv.y*0.5 - uTime*0.07*uMotion);\n"+
  "  bar = smoothstep(0.0,0.05,bar)*smoothstep(0.18,0.05,bar);\n"+
  "  col += bar*0.045*uMotion;\n"+
  "  float sheen = smoothstep(0.55,0.0, distance(uv, vec2(0.50,0.15)));\n"+
  "  col += sheen*0.030*vec3(0.55,1.0,0.78);\n"+
  "  float vig = smoothstep(0.98,0.30, length((uv-0.5)*vec2(1.05,1.0)));\n"+
  "  col *= mix(0.42,1.0, vig);\n"+
  "  col *= 1.0 - 0.028*uMotion*sin(uTime*8.0);\n"+
  "  col += (hash(fuv + fract(uTime*0.37)) - 0.5)*0.022;\n"+
  "  float spill = smoothstep(0.85,0.18, length(fuv-0.5))*0.05;\n"+
  "  vec3 room = vec3(0.012,0.03,0.022) + vec3(0.0,spill*0.6,spill*0.42);\n"+
  "  col = mix(room, col, inside);\n"+
  "  col = max(col, vec3(0.004,0.010,0.008));\n"+
  "  gl_FragColor = vec4(col,1.0);\n"+
  "}";
