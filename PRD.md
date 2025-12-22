# AI Art Station - Product Requirements Document

## Overview

AI Art Station is a **serverless desktop application** providing an intuitive UI for artists to generate images and videos using AI. Built with Tauri (Rust backend) + React + TypeScript frontend.

**Key Design Principles**:
- **Serverless**: No backend server. The app runs entirely on the user's machine and communicates directly with AI APIs.
- **Local-First**:
  - Input: Reference images are converted to Base64 locally and sent to API (no upload to intermediary servers)
  - Output: Generated images are returned as URLs, downloaded by the app, and saved locally
- **API-Agnostic**: Users configure their own API endpoint, authentication token, and model names.
- **Secure**: All credentials stored locally with AES-256 encryption.

Compatible with Volcengine's Doubao AI models (Seedream for images, Seedance for videos) and potentially other OpenAI-compatible image generation APIs.

## Target Users

- Digital artists and illustrators
- Content creators
- Designers seeking AI-assisted workflows
- Creative professionals exploring AI tools

---

## Phase 1: Image Generation

### 1.1 Core Features

#### Text-to-Image Generation
- **Description**: Generate images from text prompts
- **API**: `POST {BASE_URL}/images/generations` (user-configured)
- **Model**: User-configured image model
- **UI Components**:
  - Prompt text area (supports Chinese/English, recommended <300 Chinese chars or <600 English words)
  - Size selector:
    - Preset: `2K`, `4K`
    - Custom dimensions (total pixels: 3,686,400 - 16,777,216)
  - Aspect ratio presets: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9
  - Watermark toggle (default: off for artists)
  - Generate button
  - Loading state with progress indication

#### Image-to-Image Generation
- **Description**: Transform existing images based on prompts
- **No Server Upload**: All images are converted to Base64 locally and sent directly to AI API
- **UI Components**:
  - Image input area (drag & drop, file picker, paste)
  - Supported formats: JPEG, PNG, WebP, BMP, TIFF, GIF
  - Image constraints display:
    - Max size: 10MB
    - Max pixels: 6000x6000
    - Aspect ratio: 1/16 to 16
  - Prompt text area for transformation description
  - Size/aspect ratio selectors
  - Generate button

#### Multi-Image Fusion
- **Description**: Combine elements from multiple images (e.g., swap clothing between subjects)
- **UI Components**:
  - Multi-image upload grid (up to 14 reference images)
  - Image labeling system (Image 1, Image 2, etc.)
  - Prompt area with image reference syntax guide (e.g., "Swap Image 1's outfit with Image 2's outfit")
  - Sequential generation toggle (`sequential_image_generation`: auto/disabled)
  - Max images selector (1-15) when sequential mode is auto

#### Batch Image Generation
- **Description**: Generate multiple related images in one request
- **UI Components**:
  - Enable batch mode toggle
  - Max images slider (1-15)
  - Grid view for generated results
  - Individual image download/save options

### 1.2 Iterative Workflow & Output

#### Typical Artist Workflow
1. **Explore**: Enter keywords, generate text-to-image results, iterate until satisfied
2. **Refine**: Drag a good result to reference area, add detailed prompts, generate variations
3. **Polish**: Continue refining with more specific prompts and references

#### Result Display
- Generated image(s) downloaded from API URL and displayed prominently in main workspace
- Images auto-saved to local storage (URLs expire after 24 hours)
- Zoom and pan controls
- Image metadata display (size, generation time, tokens used)
- **Drag-to-Reference**: Drag any result image directly to the reference input area for iterative refinement
- Quick actions: "Use as Reference", "Generate Variations", "Save to Custom Location"

#### Reference Input Area
- **Local Base64 Encoding**: Reference images are read locally and converted to Base64 for API request (no server upload)
- Drop zone accepts:
  - Dragged result images from current session (already downloaded locally)
  - Dragged images from gallery (from local storage)
  - External files (drag from Finder/Explorer)
  - Pasted images (Ctrl/Cmd+V)
- **Smart Image Resize**: Automatically resize images that exceed API limits
  - Max dimensions: 6000 × 6000 pixels (resize if exceeded, preserve aspect ratio)
  - Max file size: 10MB (reduce quality/dimensions if exceeded)
  - Resize algorithm: Lanczos (high quality downscaling)
  - Show indicator when image was resized (original size → new size)
- Auto-converts to Base64 format: `data:image/<format>;base64,<encoded>`
- Visual indicator showing number of reference images (1-14)
- Click to remove individual references
- Clear all button

#### Image Gallery
- Generated images history
- Thumbnail grid view
- Filter by date, type (text-to-image, image-to-image, fusion)
- Search by prompt keywords
- **Drag from gallery** to reference area for reuse
- Batch selection for export/delete

#### Export Options
- Auto-download from URL and save to local folder
- Copy image to clipboard
- Configurable auto-save location and naming convention
- Note: Generated image URLs expire after 24 hours, so images are downloaded immediately

### 1.3 Settings & Configuration

#### API Configuration (User-Configurable, Encrypted Storage)
All API settings are entered by the user and stored locally with AES-256 encryption.

| Setting | Description | Storage |
|---------|-------------|---------|
| **Base URL** | API endpoint URL (e.g., `https://ark.cn-beijing.volces.com/api/v3`) | Encrypted |
| **API Token** | Bearer token for authentication | Encrypted |
| **Image Model** | Model ID for image generation (e.g., `doubao-seedream-4-5-251128`) | Encrypted |
| **Video Model** | Model ID for video generation (e.g., `doubao-seedance-1-0-pro-250528`) | Encrypted |

- **UI Components**:
  - Base URL input field with validation
  - API Token input (password field with show/hide toggle)
  - Image Model name input with placeholder hint
  - Video Model name input with placeholder hint
  - "Test Connection" button to verify credentials
  - "Save" button (encrypts and stores locally)
  - "Clear All" button to remove stored credentials

- **Security Requirements**:
  - AES-256-GCM encryption for all sensitive data
  - Encryption key derived from machine-specific identifier + user password (optional)
  - Data stored in Tauri's app data directory
  - Never log or expose sensitive values in console/debug output
  - Clear sensitive data from memory after use

#### Default Preferences
- Default output size (2K / 4K / custom)
- Default aspect ratio
- Watermark preference (on/off)
- **Output directory**: Where generated images are saved (default: `~/Pictures/AI-ArtStation/`)
- Output format (JPEG/PNG)
- Organize by date folders (on/off)
- Save metadata JSON alongside images (on/off)

#### Prompt Optimization
- Enable/disable prompt optimization (`optimize_prompt_options`)
- Mode selection: `standard` (higher quality, slower) / `fast` (faster, standard quality)

---

## Phase 2: Video Generation

### 2.1 Core Features

#### Text-to-Video
- **Model**: User-configured video model (e.g., `doubao-seedance-1-0-pro-250528`)
- **API**: `POST {BASE_URL}/contents/generations/tasks`
- Prompt input with motion/camera descriptions
- Video parameters:
  - Resolution: 480p, 720p, 1080p
  - Aspect ratio: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive
  - Duration: 2-12 seconds
  - Frame rate: 24 fps

#### Image-to-Video (First Frame)
- Select image from gallery or assets as first frame
- Generate video continuation from static image
- Motion description prompt (e.g., "camera slowly zooms in, hair blowing in wind")

#### Image-to-Video (First & Last Frame)
- Select two images as keyframes
- Generate smooth transition video between them
- Camera movement description (e.g., "360 degree rotation")

#### Multi-Reference Image to Video
- Upload 1-4 reference images for character/style consistency
- Prompt describes action with reference markers (e.g., "[Image 1] character walks through [Image 2] environment")

### 2.2 Video Task Management

Video generation is **asynchronous**:
1. Submit task → receive task ID
2. Poll task status until `succeeded` or `failed`
3. Download video from `content.video_url`

**UI Display** (inline in results area):
- Pending tasks show spinner with "Generating video..."
- Progress updates from API polling
- Completed videos show thumbnail with play button
- Failed tasks show error message with retry option

### 2.3 API Flow

```
POST /contents/generations/tasks
{
  "model": "{VIDEO_MODEL}",
  "content": [
    { "type": "text", "text": "prompt --ratio 16:9 --dur 5" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}

Response: { "id": "cgt-2025****" }

GET /contents/generations/tasks/{id}

Response (when completed):
{
  "id": "cgt-2025****",
  "status": "succeeded",
  "content": { "video_url": "https://..." },
  "resolution": "1080p",
  "duration": 5,
  "framespersecond": 24
}
```

---

## Phase 3: Project & Asset System

### 3.1 Projects

Projects organize work into separate spaces (e.g., "My Comic Episode 1", "Character Designs").

**Features**:
- Create, rename, delete projects
- Each project has its own assets and gallery
- Switch between projects via dropdown
- Project required before generating (no anonymous work)

**Data Model**:
```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
```

### 3.2 Assets

Assets are reusable reference images for maintaining consistency (characters, backgrounds, styles).

**Features**:
- Save from generation results or import external files
- Organize by type: Characters, Backgrounds, Styles, Props
- Drag to reference area for generation
- Tags for organization

**Data Model**:
```sql
CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL,  -- 'character', 'background', 'style', 'prop'
    tags TEXT,                  -- JSON array
    file_path TEXT NOT NULL,
    thumbnail TEXT,             -- Base64 thumbnail for sidebar
    created_at DATETIME NOT NULL
);
```

### 3.3 Updated Image/Video Storage

Images and videos are associated with projects:

```sql
-- Add project_id to existing images table
ALTER TABLE images ADD COLUMN project_id TEXT REFERENCES projects(id);

-- New videos table
CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    task_id TEXT NOT NULL,          -- API task ID
    file_path TEXT,                 -- Local path after download
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    generation_type TEXT NOT NULL,  -- 'text-to-video', 'image-to-video-first', 'image-to-video-both'
    source_image_id TEXT REFERENCES images(id),  -- Parent image if applicable
    resolution TEXT,
    duration REAL,
    fps INTEGER,
    aspect_ratio TEXT,
    status TEXT NOT NULL,           -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,
    tokens_used INTEGER,
    created_at DATETIME NOT NULL,
    completed_at DATETIME
);
```

---

## Technical Architecture

### Architecture Principle
**All business logic is handled by Rust**. The React frontend is purely for UI rendering and user interaction. All processing happens in the Tauri/Rust backend:

| Layer | Responsibility |
|-------|----------------|
| **Frontend (React)** | UI rendering, user input, display results, call Tauri commands |
| **Backend (Rust)** | HTTP requests, file I/O, image processing, encryption, database |

### Frontend (React + TypeScript)
UI-only layer. Calls Rust backend via `invoke()` for all operations.

```
src/
├── components/
│   ├── ImageGeneration/
│   │   ├── PromptInput.tsx
│   │   ├── ImageDropZone.tsx   # UI only, invokes Rust for file reading
│   │   ├── SizeSelector.tsx
│   │   ├── AspectRatioSelector.tsx
│   │   ├── GenerateButton.tsx
│   │   └── ResultPreview.tsx
│   ├── Gallery/
│   │   ├── ImageGrid.tsx
│   │   ├── ImageCard.tsx
│   │   └── FilterBar.tsx
│   ├── Settings/
│   │   ├── ApiConfig.tsx
│   │   ├── Preferences.tsx
│   │   └── SecuritySettings.tsx
│   └── common/
│       ├── Modal.tsx
│       ├── Loading.tsx
│       └── Toast.tsx
├── hooks/
│   ├── useImageGeneration.ts   # Wraps invoke('generate_image', ...)
│   ├── useGallery.ts           # Wraps invoke('get_gallery', ...)
│   └── useSettings.ts          # Wraps invoke('save_settings', ...)
├── stores/
│   └── uiStore.ts              # UI state only (loading, modals, etc.)
└── types/
    └── index.ts
```

### Backend (Tauri/Rust)
All business logic lives here.

```
src-tauri/
├── src/
│   ├── main.rs
│   ├── commands/              # Tauri command handlers (invoked from frontend)
│   │   ├── generation.rs      # generate_image, generate_video
│   │   ├── gallery.rs         # get_gallery, delete_image, search_images
│   │   ├── files.rs           # read_image_file, save_image, open_folder
│   │   └── settings.rs        # save_settings, load_settings, test_connection
│   ├── api/
│   │   └── client.rs          # HTTP client for AI API calls
│   ├── image/
│   │   ├── resize.rs          # Smart resize (Lanczos downscaling)
│   │   ├── encode.rs          # Image to Base64 conversion
│   │   └── download.rs        # Download image from URL
│   ├── storage/
│   │   ├── database.rs        # SQLite for history/metadata
│   │   └── encrypted.rs       # Encrypted config storage
│   └── crypto/
│       └── encryption.rs      # AES-256-GCM encryption
├── Cargo.toml
```

**Rust Crates**:
- `tauri`: Desktop app framework
- `reqwest`: HTTP client (API calls, image downloads)
- `image`: Image decoding, encoding, resizing
- `base64`: Base64 encoding
- `aes-gcm`: AES-256-GCM encryption
- `pbkdf2`: Key derivation
- `rusqlite`: SQLite database
- `serde` / `serde_json`: Serialization
- `tokio`: Async runtime

**Image Processing Flow** (all in Rust):
1. Frontend drops file → invokes `read_image_file(path)`
2. Rust reads file, checks dimensions
3. If > 6000px, scale down (Lanczos, preserve aspect ratio)
4. Encode to JPEG quality 90
5. If > 10MB, reduce quality iteratively (85 → 80 → 75...)
6. Return Base64 string to frontend for preview
7. On generate: Rust sends Base64 to API, downloads result URL, saves locally

### Data Storage

#### App Data Directory
```
~/.local/share/ai-artstation/  (Linux)
~/Library/Application Support/ai-artstation/  (macOS)
%APPDATA%/ai-artstation/  (Windows)
├── config.enc              # Encrypted API configuration
├── data.db                 # SQLite database (metadata, history)
└── cache/                  # Temporary files
```

#### Generated Images Directory
Default location (user-configurable in Settings):
```
~/Pictures/AI-ArtStation/  (macOS/Linux)
%USERPROFILE%/Pictures/AI-ArtStation/  (Windows)
├── 2024-01/
│   ├── 20240115_143052_abc123.jpg
│   ├── 20240115_143052_abc123.json   # Metadata (prompt, settings, etc.)
│   └── ...
├── 2024-02/
└── ...
```

**Naming Convention**: `{YYYYMMDD}_{HHMMSS}_{hash}.{ext}`
- Organized by year-month folders
- Each image has a companion `.json` metadata file containing:
  - Original prompt
  - Model used
  - Size/aspect ratio settings
  - Reference images used (file paths)
  - Generation timestamp
  - Token usage

**Encrypted Config Structure** (`config.enc`):
```json
{
  "base_url": "https://...",
  "api_token": "xxx",
  "image_model": "doubao-seedream-4-5-251128",
  "video_model": "doubao-seedance-1-0-pro-250528"
}
```

**Encryption Implementation**:
- Algorithm: AES-256-GCM
- Key derivation: PBKDF2 with machine ID + optional user password
- Rust crates: `aes-gcm`, `pbkdf2`, `rand`
- Each save generates a new random nonce

#### Other Storage
- SQLite for image history and metadata (non-sensitive)
- Local file system for generated images

---

## API Reference Summary

> **Note**: Base URL, API Token, and Model names are user-configured values stored with encryption. The examples below use placeholders.

### Image Generation Request
```
POST {BASE_URL}/images/generations
Authorization: Bearer {API_TOKEN}
```
```json
{
  "model": "{IMAGE_MODEL}",
  "prompt": "string",
  "image": "string | string[]",  // Base64 encoded: "data:image/png;base64,..."
  "size": "2K | 4K | WxH",
  "watermark": false,
  "sequential_image_generation": "auto | disabled",
  "sequential_image_generation_options": {
    "max_images": 15
  },
  "stream": false,
  "response_format": "url",
  "optimize_prompt_options": {
    "mode": "standard | fast"
  }
}
```

> **Note**: Reference images (input) are Base64 encoded locally. Generated images (output) are returned as URLs.

### Image Generation Response
```json
{
  "model": "{IMAGE_MODEL}",
  "created": 1757321139,
  "data": [
    {
      "url": "https://...",  // Temporary URL (valid for 24 hours)
      "size": "3104x1312"
    }
  ],
  "usage": {
    "generated_images": 1,
    "output_tokens": 16280,
    "total_tokens": 16280
  }
}
```
App downloads image from URL and saves to local file system.

### Video Generation Request (Phase 2)
```
POST {BASE_URL}/contents/generations/tasks
Authorization: Bearer {API_TOKEN}
```
```json
{
  "model": "{VIDEO_MODEL}",
  "content": [
    {
      "type": "text",
      "text": "prompt --ratio 16:9 --dur 5"
    }
  ]
}
```

---

## UI/UX Guidelines

### Design Principles
1. **Artist-First**: Clean, distraction-free interface focused on creativity
2. **Project-Based**: Organize work by projects (comics, animations, etc.)
3. **Asset Library**: Reusable characters, backgrounds, styles for consistency
4. **Visual Feedback**: Clear loading states, progress indicators, and error messages
5. **Efficiency**: Keyboard shortcuts, drag-and-drop, quick actions

### First Launch Experience
Users must create a project before generating. On first launch or when no project exists:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        Welcome to AI Art Station                            │
│                                                                             │
│              Create a project to start generating images & videos           │
│                                                                             │
│              Project Name: [My First Comic_______________]                  │
│                                                                             │
│                           [Create Project]                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Main Layout (After Project Selected)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Project: My Comic ▼]                                         [⚙ Settings] │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  ASSETS    │   ┌─[Image]──[Video]─────────────────────────────────────────┐ │
│  ────────  │   │                                                          │ │
│  Characters│   │                    WORKSPACE                             │ │
│   • Hero   │   │                                                          │ │
│   • Villain│   │    ┌────────────────────────────────────────────────┐    │ │
│            │   │    │                                                │    │ │
│  Backgrounds   │    │         Generation Results                     │    │ │
│   • Forest │   │    │         or Gallery View                        │    │ │
│   • City   │   │    │                                                │    │ │
│            │   │    │    [Save to Assets] [Animate] [Use as Ref]     │    │ │
│  Styles    │   │    └────────────────────────────────────────────────┘    │ │
│   • Anime  │   │                                                          │ │
│            │   └──────────────────────────────────────────────────────────┘ │
│  ────────  │                                                                │
│  GALLERY   │   ┌─ OPTIONS (collapsible) ──────────────────────────────────┐ │
│  [All]     │   │  Prompt: [________________________]                      │ │
│  [Images]  │   │  References: [+] [img1] [img2]     (drag from Assets)    │ │
│  [Videos]  │   │  Size: [2K ▼]  Ratio: [16:9 ▼]  Sequential: [off]        │ │
│            │   │                                    [Generate]            │ │
│  ────────  │   └──────────────────────────────────────────────────────────┘ │
│ [+ Import] │                                                                │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### Layout Components

#### Top Bar
- **Project Selector** (left): Dropdown to switch/create/manage projects
- **Settings Button** (right): Opens settings modal

#### Left Sidebar (200px)
- **Assets Section**: Organized by type (Characters, Backgrounds, Styles, Props)
  - Drag assets to reference area
  - Click to preview
  - Right-click: Rename, Delete, Edit tags
- **Gallery Section**: Quick filters (All / Images / Videos)
  - Click to show gallery in workspace
- **Import Button**: Add external images as assets

#### Main Workspace (Flexible)
- **Tab Bar**: Switch between [Image] and [Video] generation modes
- **Workspace Area**: Shows generation results OR gallery view
  - Results grid with action buttons
  - Gallery grid when gallery filter selected

#### Options Panel (Bottom, Collapsible)
- **Image Mode**: Prompt, references, size, aspect ratio, sequential, optimize, watermark
- **Video Mode**: Prompt, generation type, frames, resolution, duration, aspect ratio
- **Generate Button**: Disabled until project selected

### Color Scheme
- Dark mode default (artist-friendly for extended use)
- Accent colors for actions and status

---

## Success Metrics

### Phase 1
- Image generation success rate > 95%
- Average generation time < 30 seconds for 2K images
- User can complete text-to-image workflow in < 5 clicks
- Gallery supports 1000+ images without performance degradation

---

## Timeline

### Phase 1 Milestones
1. Project setup and API integration
2. Text-to-image basic implementation
3. Image-to-image implementation
4. Multi-image fusion
5. Gallery and export features
6. Settings and configuration
7. Polish and testing

---

## Appendix

### Supported Image Sizes (Recommended)
| Aspect Ratio | Dimensions |
|--------------|------------|
| 1:1 | 2048x2048 |
| 4:3 | 2304x1728 |
| 3:4 | 1728x2304 |
| 16:9 | 2560x1440 |
| 9:16 | 1440x2560 |
| 3:2 | 2496x1664 |
| 2:3 | 1664x2496 |
| 21:9 | 3024x1296 |

### Image Input Requirements
- Formats: JPEG, PNG, WebP, BMP, TIFF, GIF
- Max file size: 10MB
- Max dimensions: 6000x6000 pixels
- Aspect ratio range: 1/16 to 16
- Max reference images: 14

### Error Handling
- Network errors: Retry with exponential backoff
- API errors: Display user-friendly messages with error codes
- Content moderation: Handle rejected prompts gracefully
- Rate limiting: Queue requests and show estimated wait time
