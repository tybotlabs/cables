const CHUNK_HEADER_SIZE = 8;

const Gltf = class
{
    constructor()
    {
        this.json = {};
        this.accBuffers = [];
        this.meshes = [];
        this.nodes = [];
        this.shaders = [];
        this.timing = [];
        this.startTime = performance.now();
        this.bounds = new CABLES.CG.BoundingBox();
    }

    getNode(n)
    {
        for (let i = 0; i < this.nodes.length; i++)
        {
            if (this.nodes[i].name == n) return this.nodes[i];
        }
    }
};

function readChunk(dv, bArr, arrayBuffer, offset)
{
    const chunk = {};

    chunk.size = dv.getUint32(offset + 0, le);
    chunk.type = new TextDecoder("utf-8").decode(bArr.subarray(offset + 4, offset + 4 + 4));

    if (chunk.type == "BIN\0")
    {
        chunk.dataView = new DataView(arrayBuffer, offset + 8, chunk.size);
    }
    else
    if (chunk.type == "JSON")
    {
        const json = new TextDecoder("utf-8").decode(bArr.subarray(offset + 8, offset + 8 + chunk.size));

        try
        {
            const obj = JSON.parse(json);
            chunk.data = obj;
            outGenerator.set(obj.asset.generator);
        }
        catch (e)
        {
            console.log("could not parse json!");
        }
    }
    else
    {
        console.log("unknown chunk type", "_" + chunk.type + "_");
    }

    return chunk;
}

function loadAnims(gltf)
{
    for (let i = 0; i < gltf.json.animations.length; i++)
    {
        const an = gltf.json.animations[i];

        for (let ia = 0; ia < an.channels.length; ia++)
        {
            const chan = an.channels[ia];

            const node = gltf.nodes[chan.target.node];
            const sampler = an.samplers[chan.sampler];

            const acc = gltf.json.accessors[sampler.input];
            const bufferIn = gltf.accBuffers[sampler.input];

            const accOut = gltf.json.accessors[sampler.output];
            const bufferOut = gltf.accBuffers[sampler.output];

            let numComps = 1;
            if (accOut.type == "VEC2")numComps = 2;
            else if (accOut.type == "VEC3")numComps = 3;
            else if (accOut.type == "VEC4")numComps = 4;

            const anims = [];

            for (let k = 0; k < numComps; k++) anims.push(new CABLES.Anim());

            if (sampler.interpolation == "LINEAR") {}
            else if (sampler.interpolation == "STEP") for (k = 0; k < numComps; k++) anims[k].defaultEasing = CONSTANTS.ANIM.EASING_ABSOLUTE;
            else console.warn("[gltf] unknown interpolation", sampler.interpolation);

            for (let j = 0; j < bufferIn.length; j++)
            {
                maxTime = Math.max(bufferIn[j], maxTime);

                for (let k = 0; k < numComps; k++)
                {
                    anims[k].setValue(bufferIn[j], bufferOut[j * numComps + k]);
                }
            }

            node.setAnim(chan.target.path, anims);
        }
    }
}

function parseGltf(arrayBuffer)
{
    let j = 0, i = 0;

    const gltf = new Gltf();

    if (!arrayBuffer) return;
    const byteArray = new Uint8Array(arrayBuffer);
    let pos = 0;

    const string = new TextDecoder("utf-8").decode(byteArray.subarray(pos, 4));
    pos += 4;
    if (string != "glTF")
    {
        console.log("invalid glTF fileformat");
        return;
    }

    gltf.timing.push("Start parsing", Math.round((performance.now() - gltf.startTime)));

    const dv = new DataView(arrayBuffer);
    const version = dv.getUint32(pos, le);
    pos += 4;
    const size = dv.getUint32(pos, le);
    pos += 4;

    outVersion.set(version);

    const chunks = [];
    gltf.chunks = chunks;

    chunks.push(readChunk(dv, byteArray, arrayBuffer, pos));
    pos += chunks[0].size + CHUNK_HEADER_SIZE;
    gltf.json = chunks[0].data;
    outJson.set(gltf.json);

    chunks.push(readChunk(dv, byteArray, arrayBuffer, pos));

    const views = chunks[0].data.bufferViews;
    const accessors = chunks[0].data.accessors;

    gltf.timing.push("Parse buffers", Math.round((performance.now() - gltf.startTime)));

    if (views)
    {
        for (i = 0; i < accessors.length; i++)
        {
            const acc = accessors[i];
            const view = views[acc.bufferView];

            let numComps = 0;
            if (acc.type == "SCALAR")numComps = 1;
            else if (acc.type == "VEC2")numComps = 2;
            else if (acc.type == "VEC3")numComps = 3;
            else if (acc.type == "VEC4")numComps = 4;
            else console.error("unknown accessor type", acc.type);

            const num = acc.count * numComps;
            let accPos = (view.byteOffset || 0) + (acc.byteOffset || 0);
            let stride = view.byteStride || 0;
            let dataBuff = null;

            // 5120 (BYTE) 1
            // 5121(UNSIGNED_BYTE) 1
            // 5122 (SHORT) 2
            if (acc.componentType == 5126) // FLOAT
            {
                stride = stride || 4;
                dataBuff = new Float32Array(num);

                for (j = 0; j < num; j++)
                {
                    dataBuff[j] = chunks[1].dataView.getFloat32(accPos, le);

                    if (stride != 4 && (j + 1) % numComps === 0)accPos += stride - (numComps * 4);
                    accPos += 4;
                }
            }
            else if (acc.componentType == 5123) // UNSIGNED_SHORT
            {
                stride = stride || 2;

                dataBuff = new Uint16Array(num);

                for (j = 0; j < num; j++)
                {
                    dataBuff[j] = chunks[1].dataView.getUint16(accPos, le);

                    if (stride != 2 && (j + 1) % numComps === 0) accPos += stride - (numComps * 2);

                    accPos += 2;
                }
            }
            else
            {
                console.error("unknown component type", acc.componentType);
            }

            gltf.accBuffers.push(dataBuff);
        }
    }

    gltf.timing.push("Parse mesh groups", Math.round((performance.now() - gltf.startTime)));

    for (i = 0; i < gltf.json.meshes.length; i++)
    {
        const mesh = new gltfMeshGroup(gltf, gltf.json.meshes[i]);
        gltf.meshes.push(mesh);
    }

    gltf.timing.push("Parse nodes", Math.round((performance.now() - gltf.startTime)));

    for (i = 0; i < gltf.json.nodes.length; i++)
    {
        const node = new gltfNode(gltf.json.nodes[i], gltf);
        gltf.nodes.push(node);

        if (!node.isChild) node.calcBounds(gltf, null, gltf.bounds);
    }

    needsMatUpdate = true;

    gltf.timing.push("load anims", Math.round((performance.now() - gltf.startTime)));

    if (gltf.json.animations) loadAnims(gltf);

    gltf.timing.push("finished", Math.round((performance.now() - gltf.startTime)));

    return gltf;
}
