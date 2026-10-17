package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/**
 * Rep profile photo. Bytes live in the database (avatars are capped at 2 MB),
 * one row per rep, so the image URL is always the authenticated
 * {@code GET /api/reps/{id}/photo} endpoint — no unscoped file paths.
 */
@Entity
@Table(name = "rep_photos")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class RepPhoto extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @Column(name = "content_type", nullable = false, length = 60)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private int sizeBytes;

    @Lob
    @Column(nullable = false)
    private byte[] data;

    public Long getId() {
        return id;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public String getContentType() {
        return contentType;
    }

    public void setContentType(String contentType) {
        this.contentType = contentType;
    }

    public int getSizeBytes() {
        return sizeBytes;
    }

    public void setSizeBytes(int sizeBytes) {
        this.sizeBytes = sizeBytes;
    }

    public byte[] getData() {
        return data;
    }

    public void setData(byte[] data) {
        this.data = data;
    }
}