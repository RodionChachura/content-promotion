import fs from "fs"
import path from "path"
import fm from "front-matter"
import sharp from "sharp"

const getPostFilePath = (slug: string, fileName: string) =>
  path.resolve(__dirname, "..", "src", "posts", slug, fileName)

interface User {
  id: string
}

interface Story {
  url: string
}

interface FetchResponse<T> {
  data: T
}

interface BlogMetadata {
  title: string
  description: string
  featuredImage: string
  youTubeVideo: string
  keywords: string[]
  demo?: string
  github?: string
}

const mediumAuthorizationHeader = `Bearer ${process.env.MEDIUM_INTEGRATION_TOKEN}`

interface ParsedMarkdown {
  body: string
  attributes: BlogMetadata
}

const streamToBlob = (
  stream: fs.ReadStream,
  mimeType: string
): Promise<Blob> => {
  const chunks: any[] = []

  return new Promise((resolve, reject) => {
    stream
      .on("data", (chunk: any) => chunks.push(chunk))
      .once("end", () => {
        const blob = new Blob(chunks, { type: mimeType })
        resolve(blob)
      })
      .once("error", reject)
  })
}

const prepareContentForMedium = async (
  slug: string,
  content: string,
  metadata: BlogMetadata
) => {
  const insertions: string[] = []

  const images = content.match(/\!\[.*\]\(.*\)/g)
  await Promise.all(
    (images || []).map(async (imageToken) => {
      const imageUrl = imageToken.match(/[\(].*[^\)]/)[0].split("(")[1]
      if (imageUrl.startsWith("http")) return

      const imagePath = getPostFilePath(slug, imageUrl)

      const mediumImageUrl = await uploadImageToMedium(imagePath)
      const newImageToken = imageToken.replace(imageUrl, mediumImageUrl)
      content = content.replace(imageToken, newImageToken)
    })
  )

  if (metadata.featuredImage) {
    const mediumImageUrl = await uploadImageToMedium(
      getPostFilePath(slug, metadata.featuredImage)
    )
    insertions.push(`![](${mediumImageUrl})`)
  }

  if (metadata.youTubeVideo) {
    insertions.push(`[👋 **Watch on YouTube**](${metadata.youTubeVideo})`)
  }

  const resources: string[] = []
  if (metadata.github) {
    resources.push(`[🐙 GitHub](${metadata.github})`)
  }
  if (metadata.demo) {
    resources.push(`[🎮 Demo](${metadata.demo})`)
  }
  if (resources.length) {
    insertions.push(resources.join("  |  "))
  }

  return [...insertions, content].join("\n\n")
}

interface UploadImageResponse {
  data: {
    url: string
  }
}

const uploadImageToMedium = async (imagePath: string) => {
  const formData = new FormData()
  const fileStream = fs.createReadStream(imagePath)
  fileStream.pipe(sharp().jpeg())
  const blob = await streamToBlob(fileStream, "image/jpeg")
  formData.append("image", blob)

  const uploadFileResponse = await fetch("https://api.medium.com/v1/images", {
    method: "POST",
    body: formData,
    headers: {
      Authorization: mediumAuthorizationHeader,
    },
  })

  const resp = (await uploadFileResponse.json()) as UploadImageResponse
  return resp.data.url
}

const postOnMedium = async (slug: string) => {
  const markdownFilePath = getPostFilePath(slug, "index.md")
  const markdown = fs.readFileSync(markdownFilePath, "utf8")
  let { body, attributes } = fm(markdown) as ParsedMarkdown
  body = await prepareContentForMedium(slug, body, attributes)

  const headers = {
    "Content-Type": "application/json",
    Authorization: mediumAuthorizationHeader,
  }

  const userResponse = await fetch("https://api.medium.com/v1/me", {
    method: "GET",
    headers,
  })

  const { data: user }: FetchResponse<User> = await userResponse.json()

  const publishStoryRequest = await fetch(
    `https://api.medium.com/v1/users/${user.id}/posts`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: attributes.title,
        contentFormat: "markdown",
        tags: attributes.keywords,
        content: body,
        canonicalUrl: `https://radzion.com/blog/${slug}`,
        publishStatus: "public",
      }),
    }
  )

  const {
    data: { url },
  }: FetchResponse<Story> = await publishStoryRequest.json()
  console.log(url)
}

postOnMedium(process.argv.slice(2)[0])
